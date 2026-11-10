import type { LibraryServerConfig } from "@/config/library-config/schema";
import { readBoundedResponse } from "@/lib/source-ingestion/read-bounded-response";
import { z } from "zod";

import type { PaperIds } from "@/lib/paper-links";

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
		super(status === null ? "Openscholar could not be reached" : `Openscholar returned ${status}${code ? ` (${code})` : ""}`, options);
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

const RESOLVE_PATH = "/api/v1/evidence-libraries/papers/resolve";
const resolvedSchema = z.object({ papers: z.array(z.object({ openalexId: z.string().nullable(), doi: z.string().nullable() }).nullable()) });

/**
 * The paper each link names, as Openscholar follows it: its paper pages, a paper only its index has, a community's
 * record, an OpenAlex work with its DOI. Null for one where it finds none; up to 100 links a call. A `reader`'s
 * lookups count against their own Openscholar search allowance, as their searches do.
 */
export async function papersAtLinks(service: OpenScholarService, links: readonly string[], reader?: string): Promise<Array<PaperIds | null>> {
	if (!links.length) return [];
	const { papers } = resolvedSchema.parse(await postToOpenScholar(service, RESOLVE_PATH, { contractVersion: 1, links, ...(reader ? { clerkUserId: reader } : {}) }));
	if (papers.length !== links.length) throw new Error("Openscholar answered a different number of papers than it was asked about.");
	return papers;
}

const SEARCH_PATH = "/api/v1/evidence-libraries/papers/search";
const foundSchema = z.object({ papers: z.array(z.object({ openalexId: z.string().nullable(), doi: z.string().nullable() })) });

/**
 * The first papers a title finds on the index Openscholar's own search reads, each by its OpenAlex work and its DOI
 * where one is known. It is the `reader`'s search: it counts against their Openscholar search allowance.
 */
export async function papersByTitle(service: OpenScholarService, title: string, reader: string): Promise<PaperIds[]> {
	return foundSchema.parse(await postToOpenScholar(service, SEARCH_PATH, { contractVersion: 1, query: title, clerkUserId: reader })).papers;
}
