import { mkdir, readFile, rmdir, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

import { replaceFileAtomically } from "@/lib/atomic-file";
import {
	getLibraryConfigProbeHeaders,
	LIBRARY_CONFIG_HEALTH_PATH,
} from "@/lib/runtime-routing";

import { isCoolifyApplicationUuid } from "./coolify-application";
import { LIBRARY_RELEASED_PAGE_PATH } from "./library-maintenance-http";

/**
 * The runtime image at an exact digest. Releases moved from OpenDevEd's registry to Openscholar-ai's with the
 * repository, and communities set up before then keep their OpenDevEd image.
 */
export const runtimeImagePattern =
	/^ghcr\.io\/(?:opendeved|openscholar-ai)\/evidence-library-runtime@sha256:[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const revisionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const guardStateDirectoryMode = 0o700;
const guardConfigMode = 0o440;
const routeMode = 0o600;
const routeMarkerHeader = "X-OpenScholar-Route";
const guardRoutePriority = 200_000;
// Below the temporary guard so it wins during deployments, far above Coolify's
// label routers, whose default priority is their rule length.
const domainsRoutePriority = 100_000;
// A host removed between deployments keeps its stale Coolify label router
// until the container is recreated. This priority beats every label router,
// whose rule is at most a few hundred characters, and loses to every custom
// route, so re-adding the host here or on another library takes it back.
const releasedRoutePriority = 50_000;
// Keeps the route file bounded. The oldest released hosts drop out first and
// fall back to their label router until the next deployment clears it.
const maximumReleasedHosts = 20;
// Under OpenScholar's 30-second client timeout. Docker calls time out at 5s.
const domainsRouteDeadlineMs = 20_000;

export type LibraryRuntimeRouteInput = {
	applicationUuid: string;
	commit: string;
	customOrigins: readonly string[];
	platformOrigins: readonly string[];
	revision: string;
	runtimeImage: string;
};

export type LibraryRuntimeRouteTarget = {
	ipAddress: string;
	port: number;
	probeOrigin: string;
};

export type LibraryRuntimeGuardSource = LibraryRuntimeRouteTarget & {
	configJson: string;
	networks: readonly string[];
};

export type LibraryRuntimeGuardDocker = {
	ensureGuard: (
		input: LibraryRuntimeRouteInput & {
			configPath: string;
			source: LibraryRuntimeGuardSource;
		},
	) => Promise<LibraryRuntimeRouteTarget>;
	readApplicationWeb: (
		input: LibraryRuntimeRouteInput,
	) => Promise<LibraryRuntimeGuardSource>;
	/** Returns Coolify's Docker-provider service name for the platform address. */
	readApplicationWebService: (applicationUuid: string) => Promise<string>;
	readGuard: (
		input: LibraryRuntimeRouteInput,
	) => Promise<LibraryRuntimeRouteTarget | null>;
	readOwnedGuard: (
		applicationUuid: string,
	) => Promise<LibraryRuntimeRouteTarget | null>;
	removeGuard: (applicationUuid: string) => Promise<void>;
};

export class LibraryRuntimeGuardError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status = 409,
	) {
		super(message);
		this.name = "LibraryRuntimeGuardError";
	}
}

export type LibraryRuntimeGuardManagerOptions = {
	docker: LibraryRuntimeGuardDocker;
	maintenanceUrl: string;
	routeDirectory: string;
	stateDirectory: string;
	now?: () => number;
};

function invalidInput(message: string): never {
	throw new LibraryRuntimeGuardError("invalid_request", message, 400);
}

const dnsLabel = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const dnsHostnamePattern = new RegExp(`^(?:${dnsLabel}\\.)+${dnsLabel}$`, "u");

/**
 * Traefik renders dynamic files as Go templates and puts hosts inside
 * backtick rules, so only plain lowercase DNS names may reach a route.
 */
function isRouteHostname(hostname: string) {
	return (
		hostname.length <= 253 &&
		dnsHostnamePattern.test(hostname) &&
		isIP(hostname) === 0
	);
}

function requireHttpsOrigin(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return invalidInput("Library origins must be HTTPS origins.");
	}
	if (
		url.protocol !== "https:" ||
		url.href !== `${url.origin}/` ||
		url.username ||
		url.password ||
		url.port ||
		!isRouteHostname(url.hostname)
	) {
		return invalidInput("Library origins must be HTTPS origins.");
	}
	return url.origin;
}

function requireMaintenanceUrl(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("The maintenance URL must be an HTTP origin.");
	}
	if (
		url.protocol !== "http:" ||
		url.href !== `${url.origin}/` ||
		url.username ||
		url.password
	) {
		throw new Error("The maintenance URL must be an HTTP origin.");
	}
	return url.origin;
}

function requireApplicationUuid(applicationUuid: string) {
	if (!isCoolifyApplicationUuid(applicationUuid)) {
		return invalidInput(
			"applicationUuid must identify one Evidence Library.",
		);
	}
	return applicationUuid;
}

function requireUniqueOrigins(origins: string[]) {
	if (new Set(origins).size !== origins.length) {
		return invalidInput("Library origins must be unique.");
	}
	return origins;
}

function requireCustomOrigins(customOrigins: readonly string[]) {
	if (!Array.isArray(customOrigins) || customOrigins.length > 20) {
		return invalidInput(
			"customOrigins must contain at most twenty HTTPS origins.",
		);
	}
	return customOrigins.map(requireHttpsOrigin);
}

function requireRuntimeRouteIdentity(input: LibraryRuntimeRouteInput) {
	requireApplicationUuid(input.applicationUuid);
	if (!commitPattern.test(input.commit)) {
		return invalidInput("commit must be a lowercase Git commit.");
	}
	if (!runtimeImagePattern.test(input.runtimeImage)) {
		return invalidInput(
			"runtimeImage must be an immutable Evidence Library image.",
		);
	}
	if (!revisionPattern.test(input.revision)) {
		return invalidInput(
			"revision must identify one configuration revision.",
		);
	}
	return input;
}

function requireRuntimeRouteOrigins(input: LibraryRuntimeRouteInput) {
	const customOrigins = requireCustomOrigins(input.customOrigins);
	if (
		!Array.isArray(input.platformOrigins) ||
		input.platformOrigins.length < 1 ||
		input.platformOrigins.length > 2
	) {
		return invalidInput(
			"platformOrigins must contain one or two HTTPS origins.",
		);
	}
	const platformOrigins = input.platformOrigins.map(requireHttpsOrigin);
	requireUniqueOrigins([...platformOrigins, ...customOrigins]);
	return { customOrigins, platformOrigins };
}

function requireLibraryRuntimeRouteInput(
	input: LibraryRuntimeRouteInput,
): LibraryRuntimeRouteInput {
	requireRuntimeRouteIdentity(input);
	return { ...input, ...requireRuntimeRouteOrigins(input) };
}

function requireRouteTarget(target: LibraryRuntimeRouteTarget) {
	if (isIP(target.ipAddress) === 0) {
		throw new LibraryRuntimeGuardError(
			"runtime_upstream_invalid",
			"The Evidence Library web address could not be resolved.",
		);
	}
	if (
		!Number.isSafeInteger(target.port) ||
		target.port < 1 ||
		target.port > 65_535
	) {
		throw new LibraryRuntimeGuardError(
			"runtime_upstream_invalid",
			"The Evidence Library web port is invalid.",
		);
	}
	return {
		...target,
		probeOrigin: requireHttpsOrigin(target.probeOrigin),
	};
}

function hostnameRule(hostnames: readonly string[]) {
	return hostnames
		.map((hostname) => {
			if (!isRouteHostname(hostname)) {
				throw new Error("A route host is not a plain DNS name.");
			}
			return `Host(\`${hostname}\`)`;
		})
		.join(" || ");
}

function hostRule(origins: readonly string[]) {
	return hostnameRule(origins.map((origin) => new URL(origin).hostname));
}

// A malformed dynamic file stops Traefik from applying any later file change.
function renderRouteFile(route: unknown) {
	const content = `${JSON.stringify(route, null, 2)}\n`;
	if (content.includes("{{") || content.includes("}}")) {
		throw new Error("A route file must not contain template delimiters.");
	}
	return content;
}

const customDomainMiddlewares = [
	"ode-shield-rate-direct@file",
	"ode-shield-inflight@file",
	"ode-library-shield@file",
];

function router(
	rule: string,
	service: string,
	middlewares: readonly string[],
	priority = guardRoutePriority,
) {
	return {
		entryPoints: ["https"],
		middlewares,
		priority,
		rule,
		service,
		tls: { certResolver: "letsencrypt" },
	};
}

export function renderLibraryRuntimeRoute(input: {
	applicationUuid: string;
	commit: string;
	customOrigins: readonly string[];
	maintenanceUrl: string;
	fallbackTarget?: LibraryRuntimeRouteTarget;
	platformOrigins: readonly string[];
	revision: string;
	target?: LibraryRuntimeRouteTarget;
}) {
	const suffix = input.applicationUuid;
	const serviceName = `ode-el-${suffix}`;
	const maintenanceService = `${serviceName}-maintenance`;
	const selectedService = input.target
		? `${serviceName}-failover`
		: maintenanceService;
	const platformRule = hostRule(input.platformOrigins);
	const customRule = hostRule(input.customOrigins);
	const allRule = hostRule([
		...input.platformOrigins,
		...input.customOrigins,
	]);
	const healthCheck = (probeOrigin: string) => ({
		headers: getLibraryConfigProbeHeaders(probeOrigin),
		interval: "3s",
		path: LIBRARY_CONFIG_HEALTH_PATH,
		timeout: "2s",
	});
	const routers: Record<string, unknown> = {
		[`${serviceName}-platform-https`]: router(
			platformRule,
			selectedService,
			[
				`${serviceName}-route-marker`,
				"ode-shield-cf-origin@file",
				"ode-shield-rate-cf@file",
				"ode-shield-inflight@file",
				"ode-library-shield@file",
			],
		),
		[`${serviceName}-http`]: {
			entryPoints: ["http"],
			middlewares: [`${serviceName}-https-redirect`],
			priority: guardRoutePriority,
			rule: allRule,
			service: "noop@internal",
		},
	};
	if (customRule) {
		routers[`${serviceName}-custom-https`] = router(
			customRule,
			selectedService,
			[`${serviceName}-route-marker`, ...customDomainMiddlewares],
		);
	}
	const services: Record<string, unknown> = {
		[maintenanceService]: {
			loadBalancer: {
				servers: [{ url: input.maintenanceUrl }],
			},
		},
	};
	if (input.target) {
		services[`${serviceName}-upstream`] = {
			loadBalancer: {
				healthCheck: healthCheck(input.target.probeOrigin),
				passHostHeader: true,
				servers: [
					{
						url: `http://${input.target.ipAddress}:${input.target.port}`,
					},
				],
			},
		};
		services[selectedService] = {
			failover: {
				fallback: input.fallbackTarget
					? `${serviceName}-guard-failover`
					: maintenanceService,
				service: `${serviceName}-upstream`,
			},
		};
		if (input.fallbackTarget) {
			services[`${serviceName}-guard`] = {
				loadBalancer: {
					healthCheck: healthCheck(input.fallbackTarget.probeOrigin),
					passHostHeader: true,
					servers: [
						{
							url: `http://${input.fallbackTarget.ipAddress}:${input.fallbackTarget.port}`,
						},
					],
				},
			};
			services[`${serviceName}-guard-failover`] = {
				failover: {
					fallback: maintenanceService,
					service: `${serviceName}-guard`,
				},
			};
		}
	}
	return renderRouteFile({
		http: {
			middlewares: {
				[`${serviceName}-https-redirect`]: {
					redirectScheme: { permanent: true, scheme: "https" },
				},
				[`${serviceName}-route-marker`]: {
					headers: {
						customResponseHeaders: {
							[routeMarkerHeader]: `${input.commit}:${input.revision}`,
						},
					},
				},
			},
			routers,
			services,
		},
	});
}

type DomainsRouteParts = {
	middlewares: Record<string, unknown>;
	routers: Record<string, unknown>;
	services?: Record<string, unknown>;
};

const domainsRouteName = (applicationUuid: string) =>
	`ode-el-${applicationUuid}-domains`;

function customDomainsRoute(
	name: string,
	custom?: { dockerService: string; origins: readonly string[] },
): DomainsRouteParts {
	if (!custom) return { middlewares: {}, routers: {} };
	const rule = hostRule(custom.origins);
	return {
		middlewares: {
			[`${name}-https-redirect`]: {
				redirectScheme: { permanent: true, scheme: "https" },
			},
		},
		routers: {
			[`${name}-http`]: {
				entryPoints: ["http"],
				middlewares: [`${name}-https-redirect`],
				priority: domainsRoutePriority,
				rule,
				service: "noop@internal",
			},
			[`${name}-https`]: router(
				rule,
				`${custom.dockerService}@docker`,
				customDomainMiddlewares,
				domainsRoutePriority,
			),
			// Next's build files are named by their content, and one page view asks for dozens at once. The shared
			// per-visitor limits (40 requests in flight, a burst of 80) refused them, and a page that cannot load its
			// own code reloads or goes blank. They skip the limits and the shield; everything else keeps both.
			[`${name}-static-https`]: router(
				`(${rule}) && PathPrefix(\`/_next/static/\`)`,
				`${custom.dockerService}@docker`,
				[],
				domainsRoutePriority + 1,
			),
		},
	};
}

function releasedHostsRoute(
	name: string,
	releasedHosts: readonly string[],
	maintenanceUrl: string,
): DomainsRouteParts {
	if (releasedHosts.length === 0) return { middlewares: {}, routers: {} };
	const rule = hostnameRule(releasedHosts);
	const service = `${name}-released`;
	const middlewares = [
		"ode-shield-rate-direct@file",
		"ode-shield-inflight@file",
		`${name}-released-page`,
	];
	return {
		middlewares: {
			[`${name}-released-page`]: {
				replacePath: { path: LIBRARY_RELEASED_PAGE_PATH },
			},
		},
		routers: {
			[`${name}-released-http`]: {
				entryPoints: ["http"],
				middlewares,
				priority: releasedRoutePriority,
				rule,
				service,
			},
			[`${name}-released-https`]: router(
				rule,
				service,
				middlewares,
				releasedRoutePriority,
			),
		},
		services: {
			[service]: { loadBalancer: { servers: [{ url: maintenanceUrl }] } },
		},
	};
}

/**
 * Renders the permanent custom-domain route. It sends custom hosts straight to
 * Coolify's Docker-provider service, so attaching a domain needs no redeploy.
 * Released hosts get the verifier's not-found page instead of the library.
 */
export function renderLibraryDomainsRoute(input: {
	applicationUuid: string;
	custom?: { dockerService: string; origins: readonly string[] };
	maintenanceUrl: string;
	releasedHosts: readonly string[];
}) {
	const name = domainsRouteName(input.applicationUuid);
	const custom = customDomainsRoute(name, input.custom);
	const released = releasedHostsRoute(
		name,
		input.releasedHosts,
		input.maintenanceUrl,
	);
	return renderRouteFile({
		http: {
			middlewares: { ...custom.middlewares, ...released.middlewares },
			routers: { ...custom.routers, ...released.routers },
			...(released.services && { services: released.services }),
		},
	});
}

function unreadableDomainsRoute(): never {
	throw new LibraryRuntimeGuardError(
		"runtime_domains_route_unreadable",
		"The custom-domain route was not changed because its current file could not be read.",
		500,
	);
}

const hostTermPattern = /^Host\(`([^`]+)`\)$/u;

function ruleHostnames(rule: unknown) {
	if (rule === undefined) return [];
	if (typeof rule !== "string") return unreadableDomainsRoute();
	return rule.split(" || ").map((term) => {
		const hostname = hostTermPattern.exec(term)?.[1];
		return hostname && isRouteHostname(hostname)
			? hostname
			: unreadableDomainsRoute();
	});
}

// The file is the verifier's own JSON. Anything else means someone edited it,
// so refuse rather than guess which hosts it routed.
function parseDomainsRoute(content: string, name: string) {
	let routers: Record<string, { rule?: unknown } | null> | null;
	try {
		routers = JSON.parse(content).http.routers;
	} catch {
		return unreadableDomainsRoute();
	}
	if (typeof routers !== "object" || routers === null) {
		return unreadableDomainsRoute();
	}
	const custom = ruleHostnames(routers[`${name}-https`]?.rule);
	const released = ruleHostnames(routers[`${name}-released-https`]?.rule);
	if (custom.length + released.length === 0) return unreadableDomainsRoute();
	return [...custom, ...released];
}

/** Lists previously routed hosts, newest release first. */
async function readPreviousDomainHosts(filePath: string, name: string) {
	const content = await readFile(filePath, "utf8").catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return null;
			throw error;
		},
	);
	return content === null ? [] : parseDomainsRoute(content, name);
}

async function unlinkIfPresent(filePath: string) {
	await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOENT") throw error;
	});
}

export function createLibraryRuntimeGuardManager(
	options: LibraryRuntimeGuardManagerOptions,
) {
	const maintenanceUrl = requireMaintenanceUrl(options.maintenanceUrl);
	const routeDirectory = path.resolve(options.routeDirectory);
	const stateDirectory = path.resolve(options.stateDirectory);
	const now = options.now ?? Date.now;

	const paths = (applicationUuid: string) => {
		const statePath = path.join(stateDirectory, applicationUuid);
		return {
			configPath: path.join(statePath, "library.json"),
			routePath: path.join(
				routeDirectory,
				`ode-evidence-library-${applicationUuid}.yaml`,
			),
			statePath,
		};
	};

	const domainsPath = (applicationUuid: string) =>
		path.join(
			routeDirectory,
			`ode-evidence-library-domains-${applicationUuid}.yaml`,
		);

	// OpenScholar stops waiting after 30 seconds and lets a newer request
	// start. A late write could replace that newer host set with a stale one.
	const requireBeforeDeadline = (deadline?: number) => {
		if (deadline !== undefined && now() > deadline) {
			throw new LibraryRuntimeGuardError(
				"runtime_route_deadline",
				"The custom-domain route was not changed because the request took too long.",
				503,
			);
		}
	};

	const readReleasedHosts = async (
		applicationUuid: string,
		customOrigins: readonly string[],
	) => {
		const current = new Set(
			customOrigins.map((origin) => new URL(origin).hostname),
		);
		const previous = await readPreviousDomainHosts(
			domainsPath(applicationUuid),
			domainsRouteName(applicationUuid),
		);
		return [...new Set(previous)]
			.filter((hostname) => !current.has(hostname))
			.slice(0, maximumReleasedHosts);
	};

	const readCustomRoute = async (
		applicationUuid: string,
		origins: readonly string[],
	) =>
		origins.length === 0
			? undefined
			: {
					dockerService:
						await options.docker.readApplicationWebService(
							applicationUuid,
						),
					origins,
				};

	// Callers pass checked input. A route with no hosts is deleted.
	const writeDomainsRoute = async (
		applicationUuid: string,
		customOrigins: readonly string[],
		releasedHosts: readonly string[],
		deadline?: number,
	) => {
		const targetPath = domainsPath(applicationUuid);
		if (customOrigins.length + releasedHosts.length === 0) {
			requireBeforeDeadline(deadline);
			await unlinkIfPresent(targetPath);
			return;
		}
		const custom = await readCustomRoute(applicationUuid, customOrigins);
		await mkdir(routeDirectory, {
			recursive: true,
			mode: guardStateDirectoryMode,
		});
		requireBeforeDeadline(deadline);
		await replaceFileAtomically({
			content: renderLibraryDomainsRoute({
				applicationUuid,
				custom,
				maintenanceUrl,
				releasedHosts,
			}),
			mode: routeMode,
			targetPath,
		});
	};

	const writeRoute = async (
		input: LibraryRuntimeRouteInput,
		target?: LibraryRuntimeRouteTarget,
		fallbackTarget?: LibraryRuntimeRouteTarget,
	) => {
		const { routePath } = paths(input.applicationUuid);
		await mkdir(routeDirectory, {
			recursive: true,
			mode: guardStateDirectoryMode,
		});
		await replaceFileAtomically({
			content: renderLibraryRuntimeRoute({
				applicationUuid: input.applicationUuid,
				commit: input.commit,
				customOrigins: input.customOrigins,
				maintenanceUrl,
				platformOrigins: input.platformOrigins,
				revision: input.revision,
				...(fallbackTarget
					? { fallbackTarget: requireRouteTarget(fallbackTarget) }
					: {}),
				...(target ? { target: requireRouteTarget(target) } : {}),
			}),
			mode: routeMode,
			targetPath: routePath,
		});
		return routePath;
	};

	return {
		async prepare(input: LibraryRuntimeRouteInput) {
			const checked = requireLibraryRuntimeRouteInput(input);
			await mkdir(routeDirectory, {
				recursive: true,
				mode: guardStateDirectoryMode,
			});
			await writeRoute(checked);
			return { status: "maintenance" as const };
		},

		async protect(input: LibraryRuntimeRouteInput) {
			const checked = requireLibraryRuntimeRouteInput(input);
			const existingGuard = await options.docker.readGuard(checked);
			if (existingGuard) {
				await writeRoute(checked, existingGuard);
				return { status: "protected" as const };
			}
			const source = await options.docker.readApplicationWeb(checked);
			const { configPath, statePath } = paths(checked.applicationUuid);
			await Promise.all([
				mkdir(routeDirectory, {
					recursive: true,
					mode: guardStateDirectoryMode,
				}),
				mkdir(statePath, {
					recursive: true,
					mode: guardStateDirectoryMode,
				}),
			]);
			await replaceFileAtomically({
				content: source.configJson,
				mode: guardConfigMode,
				targetPath: configPath,
			});
			const guard = await options.docker.ensureGuard({
				...checked,
				configPath,
				source,
			});
			await writeRoute(checked, guard);
			return { status: "protected" as const };
		},

		async activate(input: LibraryRuntimeRouteInput) {
			const checked = requireLibraryRuntimeRouteInput(input);
			const [source, guard] = await Promise.all([
				options.docker.readApplicationWeb(checked),
				options.docker.readOwnedGuard(checked.applicationUuid),
			]);
			await writeRoute(checked, source, guard ?? undefined);
			return { status: "active" as const };
		},

		async finalize(input: LibraryRuntimeRouteInput) {
			const checked = requireLibraryRuntimeRouteInput(input);
			await options.docker.readApplicationWeb(checked);
			// Write the permanent route before the guard route disappears, so
			// custom hosts are never left without a route. The deployment
			// recreated Coolify's labels, so released hosts need no block.
			await writeDomainsRoute(
				checked.applicationUuid,
				checked.customOrigins,
				[],
			);
			await options.docker.removeGuard(checked.applicationUuid);
			await unlinkIfPresent(paths(checked.applicationUuid).configPath);
			await rmdir(paths(checked.applicationUuid).statePath).catch(
				(error: NodeJS.ErrnoException) => {
					if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY")
						throw error;
				},
			);
			await unlinkIfPresent(paths(checked.applicationUuid).routePath);
			return { status: "finalized" as const };
		},

		/** `receivedAt` is when the request arrived, in `now()` milliseconds. */
		async routeDomains(input: {
			applicationUuid: string;
			customOrigins: readonly string[];
			receivedAt: number;
		}) {
			const applicationUuid = requireApplicationUuid(input.applicationUuid);
			const customOrigins = requireUniqueOrigins(
				requireCustomOrigins(input.customOrigins),
			);
			await writeDomainsRoute(
				applicationUuid,
				customOrigins,
				await readReleasedHosts(applicationUuid, customOrigins),
				input.receivedAt + domainsRouteDeadlineMs,
			);
			return { customOrigins, status: "routed" as const };
		},

		async remove(applicationUuid: string) {
			requireApplicationUuid(applicationUuid);
			const { configPath, routePath, statePath } = paths(applicationUuid);
			await unlinkIfPresent(routePath);
			await unlinkIfPresent(domainsPath(applicationUuid));
			await options.docker.removeGuard(applicationUuid);
			await unlinkIfPresent(configPath);
			await rmdir(statePath).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY")
					throw error;
			});
			return { status: "removed" as const };
		},
	};
}

export type LibraryRuntimeGuardManager = ReturnType<
	typeof createLibraryRuntimeGuardManager
>;
