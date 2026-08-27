import {
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";

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

const readinessPath = "/v1/library-runtime/readiness";
const maximumBodyBytes = 4 * 1_024;

type ReadinessRequest = {
	applicationUuid: string;
	commit: string;
};

export type LibraryRuntimeContainerFact = LibraryComposeContainerFact;

export type LibraryRuntimeContainerReader = (
	applicationUuid: string,
) => Promise<readonly LibraryRuntimeContainerFact[]>;

type RuntimeVerifierServerOptions = {
	readContainers: LibraryRuntimeContainerReader;
	token: string;
};

function requireKnownPath(request: IncomingMessage) {
	const url = new URL(request.url ?? "/", "http://localhost");
	if (url.pathname === readinessPath && !url.search) return;
	throw new HttpContractError({
		code: "not_found",
		message: "The requested endpoint does not exist.",
		status: 404,
	});
}

function requireRequestRecord(body: unknown) {
	const message = "Send only applicationUuid and commit.";
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return invalidRequest(message);
	}
	const record = body as Record<string, unknown>;
	if (Object.keys(record).sort().join(",") !== "applicationUuid,commit") {
		return invalidRequest(message);
	}
	return record;
}

function requireApplicationUuid(value: unknown) {
	const message =
		"applicationUuid must be a 24-character lowercase Coolify UUID.";
	if (typeof value !== "string" || !/^[a-z0-9]{24}$/u.test(value)) {
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
	};
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
		);
		sendJson(response, 200, {
			applicationUuid: body.applicationUuid,
			commit: body.commit,
			ready: true,
			services: services.map((container) => ({
				health: container.health,
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

async function handleRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: RuntimeVerifierServerOptions,
) {
	requireKnownPath(request);
	requireMethod(request, "POST");
	requireAuthorization(request, options.token);
	requireJsonContentType(request);
	const body = parseReadinessRequest(
		await readBoundedBody(request, maximumBodyBytes),
	);
	await runReadiness(response, body, options.readContainers);
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
	});
}
