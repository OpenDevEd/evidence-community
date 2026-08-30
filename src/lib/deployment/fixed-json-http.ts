import { timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";

export class HttpContractError extends Error {
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

export function sendJson(
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

export function requireMethod(
	request: IncomingMessage,
	method: "GET" | "POST",
) {
	if (request.method === method) return;
	throw new HttpContractError({
		code: "method_not_allowed",
		headers: { Allow: method },
		message: `Use ${method} for this endpoint.`,
		status: 405,
	});
}

export function sendHealthResponse(
	request: IncomingMessage,
	response: ServerResponse,
) {
	requireMethod(request, "GET");
	sendJson(response, 200, { status: "ok" });
}

export function requireAuthorization(request: IncomingMessage, token: string) {
	const actual = Buffer.from(request.headers.authorization ?? "", "utf8");
	const expected = Buffer.from(`Bearer ${token}`, "utf8");
	if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
		return;
	}
	throw new HttpContractError({
		code: "unauthorized",
		message: "A valid bearer token is required.",
		status: 401,
	});
}

export function requireJsonContentType(request: IncomingMessage) {
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

export async function readBoundedBody(
	request: IncomingMessage,
	maximumBodyBytes: number,
) {
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

export function invalidRequest(message: string): never {
	throw new HttpContractError({
		code: "invalid_request",
		message,
		status: 400,
	});
}

export function parseJson(serialized: string): unknown {
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

export function createFixedJsonHttpServer(options: {
	handleRequest: (
		request: IncomingMessage,
		response: ServerResponse,
	) => Promise<void>;
	onInternalError?: (error: unknown) => void;
}): Server {
	const server = createServer((request, response) => {
		void options.handleRequest(request, response).catch((error: unknown) => {
			if (error instanceof HttpContractError) {
				sendJson(
					response,
					error.status,
					{ error: { code: error.code, message: error.message } },
					error.headers,
				);
				return;
			}
			options.onInternalError?.(error);
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
