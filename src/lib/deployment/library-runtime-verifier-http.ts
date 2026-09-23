import {
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";

import { isCoolifyApplicationUuid } from "./coolify-application";
import {
	LIBRARY_COMPOSE_RELEASE_LABEL,
	LibraryComposeContractError,
	requireLibraryComposeRuntimeReadiness,
	type LibraryComposeContainerFact,
} from "./library-compose-contract";
import {
	createFixedJsonHttpServer,
	HttpContractError,
	invalidRequest,
	parseJson,
	readBoundedBody,
	requireAuthorization,
	requireJsonContentType,
	requireMethod,
	sendJson,
} from "./fixed-json-http";
import {
	LibraryRuntimeGuardError,
	type LibraryRuntimeGuardManager,
	type LibraryRuntimeRouteInput,
} from "./library-runtime-guard";

const readinessPath = "/v1/library-runtime/readiness";
const maintenancePath = "/v1/library-runtime/maintenance";
const protectionPath = "/v1/library-runtime/protection";
const activationPath = "/v1/library-runtime/activation";
const finalizationPath = "/v1/library-runtime/finalization";
const removalPath = "/v1/library-runtime/removal";
const domainsPath = "/v1/library-runtime/domains";
const maximumBodyBytes = 4 * 1_024;

type ReadinessRequest = {
	applicationUuid: string;
	commit: string;
	runtimeImage: string;
};

export type LibraryRuntimeContainerFact = LibraryComposeContainerFact;

export type LibraryRuntimeContainerReader = (
	applicationUuid: string,
) => Promise<readonly LibraryRuntimeContainerFact[]>;

type RuntimeVerifierServerOptions = {
	guard: LibraryRuntimeGuardManager;
	readContainers: LibraryRuntimeContainerReader;
	token: string;
};

function requireKnownPath(request: IncomingMessage) {
	const url = new URL(request.url ?? "/", "http://localhost");
	if (url.search) {
		throw new HttpContractError({
			code: "not_found",
			message: "The requested endpoint does not exist.",
			status: 404,
		});
	}
	if (url.pathname === readinessPath) return "readiness" as const;
	if (url.pathname === maintenancePath) return "maintenance" as const;
	if (url.pathname === protectionPath) return "protection" as const;
	if (url.pathname === activationPath) return "activation" as const;
	if (url.pathname === finalizationPath) return "finalization" as const;
	if (url.pathname === removalPath) return "removal" as const;
	if (url.pathname === domainsPath) return "domains" as const;
	throw new HttpContractError({
		code: "not_found",
		message: "The requested endpoint does not exist.",
		status: 404,
	});
}

type RuntimeOperation = ReturnType<typeof requireKnownPath>;

function requireExactRequestRecord(
	body: unknown,
	fields: readonly string[],
	message: string,
) {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return invalidRequest(message);
	}
	const record = body as Record<string, unknown>;
	if (Object.keys(record).sort().join(",") !== fields.join(",")) {
		return invalidRequest(message);
	}
	return record;
}

function requireRequestRecord(body: unknown) {
	return requireExactRequestRecord(
		body,
		["applicationUuid", "commit", "runtimeImage"],
		"Send only applicationUuid, commit and runtimeImage.",
	);
}

function requireRuntimeImage(value: unknown) {
	const message =
		"runtimeImage must be the fixed Evidence Library image with a sha256 digest.";
	if (
		typeof value !== "string" ||
		!/^ghcr\.io\/opendeved\/evidence-library-runtime@sha256:[a-f0-9]{64}$/u.test(
			value,
		)
	) {
		return invalidRequest(message);
	}
	return value;
}

function requireApplicationUuid(value: unknown) {
	const message =
		"applicationUuid must be a 24-character lowercase Coolify UUID.";
	if (!isCoolifyApplicationUuid(value)) {
		return invalidRequest(message);
	}
	return value;
}

function requireCommit(value: unknown) {
	const message = "commit must be a lowercase 40-character Git commit.";
	if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) {
		return invalidRequest(message);
	}
	return value;
}

function parseReadinessRequest(serialized: string): ReadinessRequest {
	const record = requireRequestRecord(parseJson(serialized));
	return {
		applicationUuid: requireApplicationUuid(record.applicationUuid),
		commit: requireCommit(record.commit),
		runtimeImage: requireRuntimeImage(record.runtimeImage),
	};
}

function requireRouteRequestRecord(body: unknown) {
	return requireExactRequestRecord(
		body,
		[
			"applicationUuid",
			"commit",
			"customOrigins",
			"platformOrigins",
			"revision",
			"runtimeImage",
		],
		"Send only applicationUuid, commit, customOrigins, platformOrigins, revision and runtimeImage.",
	);
}

function requireCustomOriginStrings(value: unknown) {
	const message = "customOrigins must be an array of HTTPS origins.";
	if (!Array.isArray(value)) return invalidRequest(message);
	return value.map((origin) =>
		typeof origin === "string" ? origin : invalidRequest(message),
	);
}

function parseRouteRequest(serialized: string): LibraryRuntimeRouteInput {
	const record = requireRouteRequestRecord(parseJson(serialized));
	return {
		applicationUuid: requireApplicationUuid(record.applicationUuid),
		commit: requireCommit(record.commit),
		customOrigins: requireCustomOriginStrings(record.customOrigins),
		platformOrigins: Array.isArray(record.platformOrigins)
			? record.platformOrigins.map((origin) => {
					if (typeof origin !== "string") {
						return invalidRequest(
							"platformOrigins must be an array of HTTPS origins.",
						);
					}
					return origin;
				})
			: invalidRequest(
					"platformOrigins must be an array of HTTPS origins.",
				),
		revision:
			typeof record.revision === "string"
				? record.revision
				: invalidRequest(
						"revision must identify one configuration revision.",
					),
		runtimeImage: requireRuntimeImage(record.runtimeImage),
	};
}

function parseDomainsRequest(serialized: string) {
	const record = requireExactRequestRecord(
		parseJson(serialized),
		["applicationUuid", "customOrigins"],
		"Send only applicationUuid and customOrigins.",
	);
	return {
		applicationUuid: requireApplicationUuid(record.applicationUuid),
		customOrigins: requireCustomOriginStrings(record.customOrigins),
	};
}

function parseRemovalRequest(serialized: string) {
	const body = parseJson(serialized);
	const message = "Send only applicationUuid.";
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return invalidRequest(message);
	}
	const record = body as Record<string, unknown>;
	if (Object.keys(record).join(",") !== "applicationUuid") {
		return invalidRequest(message);
	}
	return requireApplicationUuid(record.applicationUuid);
}

function sendReadinessError(
	response: ServerResponse,
	error: LibraryComposeContractError,
) {
	const details = error.service ? { service: error.service } : {};
	sendJson(response, 409, {
		error: { code: error.code, message: error.message, ...details },
	});
}

async function runReadiness(
	response: ServerResponse,
	body: ReadinessRequest,
	readContainers: LibraryRuntimeContainerReader,
) {
	try {
		const containers = await readContainers(body.applicationUuid);
		const services = requireLibraryComposeRuntimeReadiness(
			containers,
			body.commit,
			body.runtimeImage,
		);
		sendJson(response, 200, {
			applicationUuid: body.applicationUuid,
			commit: body.commit,
			ready: true,
			runtimeImage: body.runtimeImage,
			services: services.map((container) => ({
				health: container.health,
				imageId: container.imageId,
				imageReference: container.imageReference,
				publishedPorts: container.publishedPorts.map((port) => ({
					containerPort: port.containerPort,
					hostIp: port.hostIp,
					hostPort: port.hostPort,
					protocol: port.protocol,
				})),
				releaseCommit: container.labels[LIBRARY_COMPOSE_RELEASE_LABEL],
				service: container.service,
				state: container.state,
			})),
		});
	} catch (error: unknown) {
		if (error instanceof LibraryComposeContractError) {
			sendReadinessError(response, error);
			return;
		}
		sendJson(response, 502, {
			error: {
				code: "runtime_inspection_failed",
				message: "The library runtime could not be checked.",
			},
		});
	}
}

async function runOperation(
	operation: Exclude<RuntimeOperation, "readiness">,
	serialized: string,
	guard: LibraryRuntimeGuardManager,
) {
	switch (operation) {
		case "removal":
			return await guard.remove(parseRemovalRequest(serialized));
		case "domains":
			return await guard.routeDomains(parseDomainsRequest(serialized));
		case "maintenance":
			return await guard.prepare(parseRouteRequest(serialized));
		case "protection":
			return await guard.protect(parseRouteRequest(serialized));
		case "activation":
			return await guard.activate(parseRouteRequest(serialized));
		case "finalization":
			return await guard.finalize(parseRouteRequest(serialized));
	}
}

async function runGuardOperation(
	response: ServerResponse,
	operation: Exclude<RuntimeOperation, "readiness">,
	serialized: string,
	guard: LibraryRuntimeGuardManager,
) {
	try {
		sendJson(response, 200, await runOperation(operation, serialized, guard));
	} catch (error: unknown) {
		if (error instanceof LibraryRuntimeGuardError) {
			sendJson(response, error.status, {
				error: { code: error.code, message: error.message },
			});
			return;
		}
		throw error;
	}
}

async function handleRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: RuntimeVerifierServerOptions,
) {
	const operation = requireKnownPath(request);
	requireMethod(request, "POST");
	requireAuthorization(request, options.token);
	requireJsonContentType(request);
	const serialized = await readBoundedBody(request, maximumBodyBytes);
	if (operation === "readiness") {
		await runReadiness(
			response,
			parseReadinessRequest(serialized),
			options.readContainers,
		);
		return;
	}
	await runGuardOperation(response, operation, serialized, options.guard);
}

export function createLibraryRuntimeVerifierServer(
	options: RuntimeVerifierServerOptions,
): Server {
	const tokenBytes = Buffer.byteLength(options.token, "utf8");
	if (tokenBytes < 32 || tokenBytes > 1_024) {
		throw new Error("The runtime verifier token must be 32 to 1024 bytes.");
	}
	return createFixedJsonHttpServer({
		handleRequest: (request, response) =>
			handleRequest(request, response, options),
		onInternalError: (error) =>
			console.error("Library runtime verifier request failed.", error),
	});
}
