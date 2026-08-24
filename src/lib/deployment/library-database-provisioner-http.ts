import { timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";

import {
	LibraryDatabaseProvisioningError,
	parseLibraryDatabasePassword,
	parseOpenScholarLibraryId,
} from "./library-database";
import type { LibraryDatabaseReconciliationResult } from "./provision-library-database";

const reconcilePath = "/v1/library-databases/reconcile";
const maximumBodyBytes = 16 * 1_024;

type ReconcileRequest = {
	libraryId: string;
	password: string;
};

export type LibraryDatabaseHttpReconciler = (
	request: ReconcileRequest,
) => Promise<LibraryDatabaseReconciliationResult>;

type ProvisionerServerOptions = {
	onError?: (error: unknown) => void;
	reconcile: LibraryDatabaseHttpReconciler;
	token: string;
};

class HttpContractError extends Error {
	readonly code: string;
	readonly headers?: Record<string, string>;
	readonly status: number;

	constructor(input: {
		code: string;
		headers?: Record<string, string>;
		message: string;
		status: number;
	}) {
		super(input.message);
		this.name = "HttpContractError";
		this.code = input.code;
		this.headers = input.headers;
		this.status = input.status;
	}
}

function sendJson(
	response: ServerResponse,
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
) {
	const serialized = JSON.stringify(body);
	response.writeHead(status, {
		"Cache-Control": "no-store",
		"Content-Length": Buffer.byteLength(serialized, "utf8"),
		"Content-Type": "application/json; charset=utf-8",
		"X-Content-Type-Options": "nosniff",
		...headers,
	});
	response.end(serialized);
}

function hasValidAuthorization(request: IncomingMessage, token: string) {
	const actual = Buffer.from(request.headers.authorization ?? "", "utf8");
	const expected = Buffer.from(`Bearer ${token}`, "utf8");
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function requireJsonContentType(request: IncomingMessage) {
	const contentType = request.headers["content-type"]
		?.split(";", 1)[0]
		?.trim()
		.toLowerCase();
	if (contentType === "application/json") return;
	throw new HttpContractError({
		code: "unsupported_media_type",
		message: "Content-Type must be application/json.",
		status: 415,
	});
}

async function readBoundedBody(request: IncomingMessage) {
	const declaredLength = Number(request.headers["content-length"]);
	if (
		Number.isFinite(declaredLength) &&
		declaredLength > maximumBodyBytes
	) {
		request.resume();
		throw new HttpContractError({
			code: "payload_too_large",
			message: "The request body is too large.",
			status: 413,
		});
	}

	const chunks: Buffer[] = [];
	let byteLength = 0;
	let tooLarge = false;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		byteLength += buffer.byteLength;
		if (byteLength > maximumBodyBytes) {
			tooLarge = true;
			continue;
		}
		chunks.push(buffer);
	}
	if (tooLarge) {
		throw new HttpContractError({
			code: "payload_too_large",
			message: "The request body is too large.",
			status: 413,
		});
	}
	return Buffer.concat(chunks).toString("utf8");
}

function invalidRequest(message: string): never {
	throw new HttpContractError({
		code: "invalid_request",
		message,
		status: 400,
	});
}

function parseJson(serialized: string): unknown {
	try {
		return JSON.parse(serialized);
	} catch {
		throw new HttpContractError({
			code: "invalid_json",
			message: "The request body must be valid JSON.",
			status: 400,
		});
	}
}

function requireRequestRecord(body: unknown) {
	if (!body) return invalidRequest("Send only libraryId and password.");
	if (typeof body !== "object") {
		return invalidRequest("Send only libraryId and password.");
	}
	if (Array.isArray(body)) {
		return invalidRequest("Send only libraryId and password.");
	}
	return body as Record<string, unknown>;
}

function requireExactFields(record: Record<string, unknown>) {
	if (Object.keys(record).sort().join(",") !== "libraryId,password") {
		invalidRequest("Send only libraryId and password.");
	}
	return record;
}

function requireLibraryId(value: unknown) {
	const message =
		"libraryId must be a non-empty string of at most 256 bytes.";
	if (typeof value !== "string") return invalidRequest(message);
	try {
		return parseOpenScholarLibraryId(value);
	} catch {
		return invalidRequest(message);
	}
}

function requirePassword(value: unknown) {
	const message =
		"password must be a non-empty string of at most 1024 bytes.";
	if (typeof value !== "string") return invalidRequest(message);
	try {
		return parseLibraryDatabasePassword(value);
	} catch {
		return invalidRequest(message);
	}
}

function parseReconcileRequest(serialized: string): ReconcileRequest {
	const record = requireExactFields(requireRequestRecord(parseJson(serialized)));
	return {
		libraryId: requireLibraryId(record.libraryId),
		password: requirePassword(record.password),
	};
}

const conflictMessages = {
	database_object_owner_conflict:
		"The library database contains objects owned by another login.",
	database_owner_conflict:
		"The library database is owned by another login.",
	extension_owner_conflict:
		"A required database extension is owned by another login.",
	login_database_conflict: "The library login owns another database.",
	login_security_conflict: "The library login has server-wide rights.",
} as const;

function sendReconciliationError(
	response: ServerResponse,
	error: unknown,
	onError: (error: unknown) => void,
) {
	onError(error);
	if (
		error instanceof LibraryDatabaseProvisioningError &&
		error.code in conflictMessages
	) {
		const code = error.code as keyof typeof conflictMessages;
		sendJson(response, 409, {
			error: { code, message: conflictMessages[code] },
		});
		return;
	}
	sendJson(response, 500, {
		error: {
			code: "database_reconciliation_failed",
			message: "The library database could not be reconciled.",
		},
	});
}

function requireMethod(request: IncomingMessage, method: "GET" | "POST") {
	if (request.method === method) return;
	throw new HttpContractError({
		code: "method_not_allowed",
		headers: { Allow: method },
		message: `Use ${method} for this endpoint.`,
		status: 405,
	});
}

function requireAuthorization(request: IncomingMessage, token: string) {
	if (hasValidAuthorization(request, token)) return;
	throw new HttpContractError({
		code: "unauthorized",
		message: "A valid bearer token is required.",
		status: 401,
	});
}

function requireKnownPath(url: URL) {
	if (!url.search && ["/health", reconcilePath].includes(url.pathname)) return;
	throw new HttpContractError({
		code: "not_found",
		message: "The requested endpoint does not exist.",
		status: 404,
	});
}

async function handleReconcileRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: Required<ProvisionerServerOptions>,
) {
	requireMethod(request, "POST");
	requireAuthorization(request, options.token);
	requireJsonContentType(request);
	const body = parseReconcileRequest(await readBoundedBody(request));
	await runReconciliation(response, body, options);
}

async function handleRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: Required<ProvisionerServerOptions>,
) {
	const url = new URL(request.url ?? "/", "http://localhost");
	requireKnownPath(url);
	if (url.pathname === "/health") {
		requireMethod(request, "GET");
		sendJson(response, 200, { status: "ok" });
		return;
	}
	await handleReconcileRequest(request, response, options);
}

async function runReconciliation(
	response: ServerResponse,
	body: ReconcileRequest,
	options: Required<ProvisionerServerOptions>,
) {
	try {
		const result = await options.reconcile(body);
		sendJson(response, 200, { libraryId: body.libraryId, ...result });
	} catch (error: unknown) {
		sendReconciliationError(response, error, options.onError);
	}
}

export function createLibraryDatabaseProvisionerServer(
	options: ProvisionerServerOptions,
): Server {
	if (Buffer.byteLength(options.token, "utf8") < 32) {
		throw new Error("The database provisioner token must be at least 32 bytes.");
	}
	const resolved: Required<ProvisionerServerOptions> = {
		onError: options.onError ?? ((error) => console.error(error)),
		reconcile: options.reconcile,
		token: options.token,
	};
	const server = createServer((request, response) => {
		void handleRequest(request, response, resolved).catch((error: unknown) => {
			if (error instanceof HttpContractError) {
				sendJson(
					response,
					error.status,
					{ error: { code: error.code, message: error.message } },
					error.headers,
				);
				return;
			}
			resolved.onError(error);
			sendJson(response, 500, {
				error: {
					code: "internal_error",
					message: "The request could not be processed.",
				},
			});
		});
	});
	server.headersTimeout = 10_000;
	server.requestTimeout = 15_000;
	server.keepAliveTimeout = 5_000;
	server.maxHeadersCount = 32;
	return server;
}
