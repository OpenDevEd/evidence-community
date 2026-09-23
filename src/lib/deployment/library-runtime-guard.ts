import { mkdir, rmdir, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

import { replaceFileAtomically } from "@/lib/atomic-file";
import {
	getLibraryConfigProbeHeaders,
	LIBRARY_CONFIG_HEALTH_PATH,
} from "@/lib/runtime-routing";

import { isCoolifyApplicationUuid } from "./coolify-application";

const runtimeImagePattern =
	/^ghcr\.io\/opendeved\/evidence-library-runtime@sha256:[a-f0-9]{64}$/u;
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

function hostRule(origins: readonly string[]) {
	return origins
		.map((origin) => {
			const { hostname } = new URL(origin);
			if (!isRouteHostname(hostname)) {
				throw new Error("A route host is not a plain DNS name.");
			}
			return `Host(\`${hostname}\`)`;
		})
		.join(" || ");
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

/**
 * Renders the permanent custom-domain route. It sends custom hosts straight to
 * Coolify's Docker-provider service, so attaching a domain needs no redeploy.
 */
export function renderLibraryDomainsRoute(input: {
	applicationUuid: string;
	customOrigins: readonly string[];
	dockerService: string;
}) {
	const name = `ode-el-${input.applicationUuid}-domains`;
	const rule = hostRule(input.customOrigins);
	return renderRouteFile({
		http: {
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
					`${input.dockerService}@docker`,
					customDomainMiddlewares,
					domainsRoutePriority,
				),
			},
		},
	});
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

	// Callers pass checked input. An empty list removes the permanent route.
	const writeDomainsRoute = async (
		applicationUuid: string,
		customOrigins: readonly string[],
	) => {
		const targetPath = domainsPath(applicationUuid);
		if (customOrigins.length === 0) {
			await unlinkIfPresent(targetPath);
			return;
		}
		const dockerService =
			await options.docker.readApplicationWebService(applicationUuid);
		await mkdir(routeDirectory, {
			recursive: true,
			mode: guardStateDirectoryMode,
		});
		await replaceFileAtomically({
			content: renderLibraryDomainsRoute({
				applicationUuid,
				customOrigins,
				dockerService,
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
			// custom hosts are never left without a route.
			await writeDomainsRoute(
				checked.applicationUuid,
				checked.customOrigins,
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

		async routeDomains(input: {
			applicationUuid: string;
			customOrigins: readonly string[];
		}) {
			const applicationUuid = requireApplicationUuid(input.applicationUuid);
			const customOrigins = requireUniqueOrigins(
				requireCustomOrigins(input.customOrigins),
			);
			await writeDomainsRoute(applicationUuid, customOrigins);
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
