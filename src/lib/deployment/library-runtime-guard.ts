import { mkdir, rmdir, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

import { replaceFileAtomically } from "@/lib/atomic-file";

import { isCoolifyApplicationUuid } from "./coolify-application";

const runtimeImagePattern =
	/^ghcr\.io\/opendeved\/evidence-library-runtime@sha256:[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const revisionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const guardStateDirectoryMode = 0o700;
const guardConfigMode = 0o440;
const routeMode = 0o600;

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
		url.port
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

function requireRuntimeRouteIdentity(input: LibraryRuntimeRouteInput) {
	if (!isCoolifyApplicationUuid(input.applicationUuid)) {
		return invalidInput(
			"applicationUuid must identify one Evidence Library.",
		);
	}
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
	if (
		!Array.isArray(input.customOrigins) ||
		input.customOrigins.length > 20
	) {
		return invalidInput(
			"customOrigins must contain at most twenty HTTPS origins.",
		);
	}
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
	const customOrigins = input.customOrigins.map(requireHttpsOrigin);
	const origins = [...platformOrigins, ...customOrigins];
	if (new Set(origins).size !== origins.length) {
		return invalidInput("Library origins must be unique.");
	}
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
	return target;
}

function hostRule(origins: readonly string[]) {
	return origins
		.map((origin) => `Host(\`${new URL(origin).hostname}\`)`)
		.join(" || ");
}

function router(rule: string, service: string, middlewares: readonly string[]) {
	return {
		entryPoints: ["https"],
		middlewares,
		priority: 200_000,
		rule,
		service,
		tls: { certResolver: "letsencrypt" },
	};
}

export function renderLibraryRuntimeRoute(input: {
	applicationUuid: string;
	customOrigins: readonly string[];
	maintenanceUrl: string;
	fallbackTarget?: LibraryRuntimeRouteTarget;
	platformOrigins: readonly string[];
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
	const routers: Record<string, unknown> = {
		[`${serviceName}-platform-https`]: router(
			platformRule,
			selectedService,
			[
				"ode-shield-cf-origin@file",
				"ode-shield-rate-cf@file",
				"ode-shield-inflight@file",
				"ode-library-shield@file",
			],
		),
		[`${serviceName}-http`]: {
			entryPoints: ["http"],
			middlewares: [`${serviceName}-https-redirect`],
			priority: 200_000,
			rule: allRule,
			service: "noop@internal",
		},
	};
	if (customRule) {
		routers[`${serviceName}-custom-https`] = router(
			customRule,
			selectedService,
			[
				"ode-shield-rate-direct@file",
				"ode-shield-inflight@file",
				"ode-library-shield@file",
			],
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
				healthCheck: {
					interval: "3s",
					path: "/api/library-config/health",
					timeout: "2s",
				},
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
				healthCheck: {},
				service: `${serviceName}-upstream`,
			},
		};
		if (input.fallbackTarget) {
			services[`${serviceName}-guard`] = {
				loadBalancer: {
					healthCheck: {
						interval: "3s",
						path: "/api/library-config/health",
						timeout: "2s",
					},
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
					healthCheck: {},
					service: `${serviceName}-guard`,
				},
			};
		}
	}
	return `${JSON.stringify(
		{
			http: {
				middlewares: {
					[`${serviceName}-https-redirect`]: {
						redirectScheme: { permanent: true, scheme: "https" },
					},
				},
				routers,
				services,
			},
		},
		null,
		2,
	)}\n`;
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
				customOrigins: input.customOrigins,
				maintenanceUrl,
				platformOrigins: input.platformOrigins,
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
			await unlink(paths(checked.applicationUuid).routePath).catch(
				(error: NodeJS.ErrnoException) => {
					if (error.code !== "ENOENT") throw error;
				},
			);
			await options.docker.removeGuard(checked.applicationUuid);
			await unlink(paths(checked.applicationUuid).configPath).catch(
				(error: NodeJS.ErrnoException) => {
					if (error.code !== "ENOENT") throw error;
				},
			);
			await rmdir(paths(checked.applicationUuid).statePath).catch(
				(error: NodeJS.ErrnoException) => {
					if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY")
						throw error;
				},
			);
			return { status: "finalized" as const };
		},

		async remove(applicationUuid: string) {
			if (!isCoolifyApplicationUuid(applicationUuid)) {
				return invalidInput(
					"applicationUuid must identify one Evidence Library.",
				);
			}
			const { configPath, routePath, statePath } = paths(applicationUuid);
			await unlink(routePath).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
			});
			await options.docker.removeGuard(applicationUuid);
			await unlink(configPath).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
			});
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
