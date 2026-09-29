import type { LibraryServerConfig } from "@/config/library-config/schema";
import { readBoundedResponse } from "@/lib/source-ingestion/read-bounded-response";

export type OpenScholarService = LibraryServerConfig["authentication"]["openScholar"];

/**
 * OpenScholar answered without success, or never answered (`status` null).
 * `code` is the `error` its body names, when it names one.
 */
export class OpenScholarServiceError extends Error {
	constructor(
		readonly status: number | null,
		readonly code: string | null,
		options?: ErrorOptions,
	) {
		super(status === null ? "OpenScholar could not be reached" : `OpenScholar returned ${status}${code ? ` (${code})` : ""}`, options);
		this.name = "OpenScholarServiceError";
	}
}

function errorCode(body: string) {
	try {
		const parsed: unknown = JSON.parse(body);
		const code = parsed && typeof parsed === "object" && "error" in parsed ? parsed.error : null;
		return typeof code === "string" ? code : null;
	} catch {
		return null;
	}
}

/** A request or body that failed before OpenScholar finished answering; a caller's own abort stays an abort. */
function unreachable(signal: AbortSignal | undefined) {
	return (error: unknown): never => {
		if (signal?.aborted || error instanceof OpenScholarServiceError) throw error;
		throw new OpenScholarServiceError(null, null, { cause: error });
	};
}

/**
 * Posts one request to OpenScholar with the library's machine credential,
 * adding the library's id, and returns the JSON it answers.
 */
export async function postToOpenScholar(
	service: OpenScholarService,
	path: string,
	body: object,
	options: { fetch?: typeof fetch; maxBytes?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<unknown> {
	const timeoutMs = options.timeoutMs ?? 10_000;
	const response = await (options.fetch ?? fetch)(new URL(path, service.convexSiteUrl), {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${service.machineCredential}` },
		body: JSON.stringify({ ...body, libraryId: service.libraryId }),
		signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]),
	}).catch(unreachable(options.signal));
	const bytes = await readBoundedResponse(
		response,
		response.ok ? (options.maxBytes ?? 2_000_000) : 8_192,
		timeoutMs,
		timeoutMs,
		(message) => new OpenScholarServiceError(null, null, { cause: new Error(message) }),
	).catch(unreachable(options.signal));
	const text = new TextDecoder().decode(bytes);
	if (!response.ok) throw new OpenScholarServiceError(response.status, errorCode(text));
	return JSON.parse(text) as unknown;
}
