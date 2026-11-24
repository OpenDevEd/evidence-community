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

const STORED_PDF_PATH = "/api/v1/evidence-libraries/papers/stored-pdf";
const storedPdfSchema = z.object({ link: z.string().url().nullable() });

/**
 * A link to Openscholar's stored copy of a paper's PDF, good for an hour, by the paper's OpenAlex work or the address
 * a copy was fetched from. Null when its store has none. A community reads a stored copy for nothing.
 */
export async function storedPdfLink(service: OpenScholarService, paper: { openalexId?: string | undefined; url: string }): Promise<string | null> {
	const { openalexId, url } = paper;
	return storedPdfSchema.parse(await postToOpenScholar(service, STORED_PDF_PATH, { contractVersion: 1, ...(openalexId ? { openalexId } : {}), url })).link;
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

export const REPORTS_PATH = "/api/v1/evidence-libraries/reports/records";
/**
 * DOIs one request asks Openscholar about. Openscholar takes a hundred; with its authors' affiliations a report's
 * details can run to about 400 KB (200 authors, five institutions each, a long abstract), so 10 keep the largest
 * answer well inside the 8 MB one request reads.
 */
const REPORTS_PER_REQUEST = 10;

const liveReportSchema = z.object({
	state: z.literal("live"),
	key: z.string().min(1).max(64),
	doi: z.string().min(1).max(512),
	/** Its DOCiD, the Africa PID Alliance's Handle, when Openscholar registered one. An Openscholar older than these sends none. */
	docid: z.string().max(256).optional(),
	/** When the report's details were last set, as an ISO time. */
	version: z.string().min(1).max(64),
	title: z.string(),
	subtitle: z.string(),
	type: z.string(),
	language: z.string(),
	date: z.string(),
	licence: z.string(),
	abstract: z.string(),
	authors: z.array(z.object({
		name: z.string(),
		orcid: z.string().nullable(),
		/** Where the author was for this work: OpenAlex's institution (I…) where it has one, its country, its ROR ID. An Openscholar older than these sends none. */
		affiliations: z.array(z.object({ id: z.string().nullable(), name: z.string(), country: z.string(), ror: z.string().optional() })).max(50).default([]),
	})).max(1_000),
	keywords: z.array(z.string()).max(1_000),
	/** OpenAlex topics (T…) with how sure the reader was, which a record of an OpenAlex works source imports from its raw details. */
	topics: z.array(z.object({ id: z.string(), name: z.string(), score: z.number().min(0).max(1) })).max(100).default([]),
	series: z.string(),
	pageUrl: z.string().url().max(2048),
	pdfUrl: z.string().url().max(2048).nullable(),
});
const withdrawnReportSchema = z.object({ state: z.literal("withdrawn"), key: z.string().min(1).max(64), doi: z.string().min(1).max(512), version: z.string().min(1).max(64) });
const reportsSchema = z.object({ reports: z.array(z.union([liveReportSchema, withdrawnReportSchema]).nullable()) });

export type LiveOpenscholarReport = z.infer<typeof liveReportSchema>;
/** A report published on Openscholar, as it stands there now: live with its details, or withdrawn. */
export type OpenscholarReport = LiveOpenscholarReport | z.infer<typeof withdrawnReportSchema>;

/**
 * The Openscholar Reports among these DOIs, by the DOI as it was asked. Openscholar is asked before OpenAlex and the
 * DOI lookup: a report is in neither until its deposit is indexed, and its record stays Openscholar's (OpenDevEd/new-el#814).
 * A hundred DOIs a request, so a sync asks once for all it holds.
 */
export async function reportsByDoi(service: OpenScholarService, dois: readonly string[], options: { fetch?: typeof fetch } = {}): Promise<Map<string, OpenscholarReport>> {
	const found = new Map<string, OpenscholarReport>();
	for (let at = 0; at < dois.length; at += REPORTS_PER_REQUEST) {
		const asked = dois.slice(at, at + REPORTS_PER_REQUEST);
		const answer = await postToOpenScholar(service, REPORTS_PATH, { contractVersion: 1, dois: asked }, { fetch: options.fetch, timeoutMs: 30_000, maxBytes: 8_000_000 }).catch((error: unknown) => {
			// An Openscholar that doesn't publish reports yet has no such address: none of the DOIs is a report of its.
			if (error instanceof OpenScholarServiceError && error.status === 404) return null;
			throw error;
		});
		if (!answer) return found;
		const { reports } = reportsSchema.parse(answer);
		if (reports.length !== asked.length) throw new Error("Openscholar answered a different number of reports than it was asked about.");
		reports.forEach((report, index) => report && found.set(asked[index]!, report));
	}
	return found;
}
