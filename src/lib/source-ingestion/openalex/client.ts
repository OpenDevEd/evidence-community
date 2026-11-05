import { normalizeDoi } from "@/lib/doi";
import { readBoundedResponse } from "../read-bounded-response";
import {
	OPENALEX_MAX_PAGE_SIZE,
	openAlexGroupsSchema,
	openAlexInstitutionLocationsSchema,
	openAlexPageSchema,
	openAlexQuerySchema,
	type OpenAlexPage,
	type OpenAlexQuery,
} from "./schema";
import { asOpenAlexWork, readSearchEngineAccess, SEARCH_ENGINE_ORIGIN, searchEngineHeaders } from "./search-engine";
import { workIsOpenAccess } from "./work";

/** OpenAlex refuses more ids than this in one filter. */
export const OPENALEX_MAX_IDS_PER_FILTER = 100;

/** A filter for the works with these ids, at most `OPENALEX_MAX_IDS_PER_FILTER` of them. */
export function worksWithIds(ids: readonly string[]): OpenAlexQuery {
	if (!ids.length || ids.length > OPENALEX_MAX_IDS_PER_FILTER) {
		throw new Error(`An OpenAlex id filter takes 1 to ${OPENALEX_MAX_IDS_PER_FILTER} ids`);
	}
	return { filter: `ids.openalex:${ids.join("|")}` };
}

export class OpenAlexApiError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
	) {
		super(message);
		this.name = "OpenAlexApiError";
	}
}

function worksUrl(
	query: OpenAlexQuery,
	cursor: string | null,
	pageSize: number,
	apiKey: string,
) {
	if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > OPENALEX_MAX_PAGE_SIZE) {
		throw new Error(`OpenAlex pageSize must be between 1 and ${OPENALEX_MAX_PAGE_SIZE}`);
	}
	const approved = openAlexQuerySchema.parse(query);
	const engine = readSearchEngineAccess(apiKey);
	const origin = engine ? SEARCH_ENGINE_ORIGIN : "https://api.openalex.org";
	// OQL runs at the API root with the query in the POST body.
	const url = new URL(approved.oql ? `${origin}/` : `${origin}/works`);
	for (const key of ["filter", "search"] as const) {
		if (approved[key]) url.searchParams.set(key, approved[key]);
	}
	if (cursor) url.searchParams.set("cursor", cursor);
	url.searchParams.set("per_page", String(pageSize));
	if (!engine) url.searchParams.set("api_key", apiKey);
	return url;
}

/** OQL goes in a POST body, since it outgrows a URL. */
function requestInit(oql: string | undefined, apiKey: string): RequestInit {
	const engine = readSearchEngineAccess(apiKey);
	const headers = { Accept: "application/json", ...(engine ? searchEngineHeaders(engine) : {}) };
	if (!oql) return { headers };
	return {
		method: "POST",
		body: JSON.stringify({ oql }),
		headers: { ...headers, "Content-Type": "application/json" },
	};
}

// OpenAlex fails often, from a network blip to an outage of most of an hour. A
// request keeps trying, waiting longer each time up to a minute, until it has
// waited this long in all; only then does the import stop, and its next run
// carries on from the same place.
const OUTAGE_WAIT_MS = 60 * 60_000;
const MAX_RETRY_DELAY_MS = 60_000;

const isRetryable = (response: Response) => response.status === 429 || response.status >= 500;

/** Says why a request is tried again, so an outage shows in the log while the import waits. */
function logRetry(reason: string, attempt: number, delayMs: number, waitedMs: number) {
	console.warn("OpenAlex request failed; trying again", {
		reason: reason.slice(0, 200),
		attempt: attempt + 1,
		waitSeconds: delayMs / 1000,
		waitedMinutes: Math.round(waitedMs / 60_000),
	});
}

export function failureText(error: unknown) {
	if (!(error instanceof Error)) return String(error);
	const cause = error.cause as { code?: string; message?: string } | undefined;
	return cause ? `${error.message} (${cause.code ?? cause.message})` : error.message;
}

// OpenAlex's search gives up after about 8 seconds. On a busy day a long OQL
// query can miss that at 200 works a page yet make it at 50, so a timed-out
// page is asked for again at half the size, down to MIN_PAGE_SIZE. After
// PAGES_BEFORE_GROWING pages at a smaller size, pages double again.
const SEARCH_TIMEOUT = "Elasticsearch error: Connection timed out";
const MIN_PAGE_SIZE = 25;
const PAGES_BEFORE_GROWING = 10;

// OpenAlex leaves `next_cursor` out of any page shorter than asked for, and a
// busy search can answer with part of a page. A short page that would end the
// scan is asked for again this many times first.
const LAST_PAGE_CHECKS = 2;

/** A page that ends the scan although the query has more works than it holds. */
const endsEarly = (page: OpenAlexPage, size: number) =>
	!page.meta.next_cursor && page.results.length < size && page.results.length < page.meta.count;

class OpenAlexSearchTimeoutError extends OpenAlexApiError {}

/**
 * Throws on OpenAlex's search timeout, so the page can be asked for at a
 * smaller size. Any other 500 comes back with its body, to be retried or
 * reported as before.
 */
async function throwIfSearchTimeout(response: Response) {
	if (response.status !== 500) return response;
	const body = await readBoundedResponse(response, 8_192, 30_000, 30_000).then(
		(bytes) => new TextDecoder().decode(bytes),
		() => "",
	);
	if (body.includes(SEARCH_TIMEOUT))
		throw new OpenAlexSearchTimeoutError(`OpenAlex works returned 500: ${body}`, 500);
	return new Response(body, { status: response.status, headers: response.headers });
}

export const backoff = (attempt: number) => Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** attempt);

export function retryDelay(response: Response, attempt: number) {
	const retryAfter = response.headers.get("retry-after");
	const seconds = Number(retryAfter);
	const requestedDelay = Number.isFinite(seconds)
		? seconds * 1000
		: Date.parse(retryAfter ?? "") - Date.now();
	return Math.min(MAX_RETRY_DELAY_MS, Math.max(backoff(attempt), requestedDelay || 0));
}

/** Adds each work's open access to `open` by DOI; a DOI is open when any of its works is. */
function addOpenAccess(open: Map<string, boolean>, works: readonly unknown[]) {
	for (const work of works) {
		const doi = normalizeDoi((work as { doi?: string | null } | null)?.doi);
		const isOa = workIsOpenAccess(work);
		if (doi && isOa !== null) open.set(doi, open.get(doi) === true || isOa);
	}
}

export class OpenAlexClient {
	private pageLimit = OPENALEX_MAX_PAGE_SIZE;
	private pagesAtLimit = 0;

	constructor(
		private readonly options: {
			apiKey: string;
			fetch?: typeof fetch;
			sleep?: (milliseconds: number) => Promise<void>;
			maxResponseBytes?: number;
		},
	) {}

	private sleep(ms: number) {
		return this.options.sleep ? this.options.sleep(ms) : new Promise<void>((resolve) => setTimeout(resolve, ms));
	}

	private async fetchWithRetries(url: URL, oql?: string, canShrink = false) {
		const init = requestInit(oql, this.options.apiKey);
		const request = this.options.fetch ?? fetch;
		let waited = 0;
		for (let attempt = 0; ; attempt++) {
			let response: Response;
			try {
				response = await request(url, {
					...init,
					redirect: "error",
					signal: AbortSignal.timeout(30_000),
				});
			} catch (error) {
				const delay = backoff(attempt);
				if (waited + delay > OUTAGE_WAIT_MS)
					throw new OpenAlexApiError(`OpenAlex works request failed: ${failureText(error)}`);
				logRetry(failureText(error), attempt, delay, waited);
				await this.sleep(delay);
				waited += delay;
				continue;
			}
			if (canShrink) response = await throwIfSearchTimeout(response);
			if (!isRetryable(response)) return response;
			const delay = retryDelay(response, attempt);
			// The last answer is reported as it is.
			if (waited + delay > OUTAGE_WAIT_MS) return response;
			await response.body?.cancel();
			logRetry(`HTTP ${response.status}`, attempt, delay, waited);
			await this.sleep(delay);
			waited += delay;
		}
	}

	/** Counts of the query's works by publication year. Works with no year are left out. */
	async yearCounts(query: OpenAlexQuery) {
		const grouped = query.oql ? { oql: `${query.oql} group by publication_year` } : query;
		const url = worksUrl(grouped, null, OPENALEX_MAX_PAGE_SIZE, this.options.apiKey);
		if (!query.oql) url.searchParams.set("group_by", "publication_year");
		const { group_by } = openAlexGroupsSchema.parse(await this.read(url, grouped.oql));
		return group_by.flatMap(({ key, count }) => (/^\d{4}$/.test(key) ? [{ year: Number(key), count }] : []));
	}

	/**
	 * Whether each DOI's work is open access, for 1 to `OPENALEX_MAX_IDS_PER_FILTER` normalised DOIs. A DOI OpenAlex
	 * does not know is left out; one it holds several works for is open when any of them is.
	 */
	async openAccessByDoi(dois: readonly string[]) {
		if (!dois.length || dois.length > OPENALEX_MAX_IDS_PER_FILTER) {
			throw new Error(`An OpenAlex DOI filter takes 1 to ${OPENALEX_MAX_IDS_PER_FILTER} DOIs`);
		}
		const open = new Map<string, boolean>();
		// Cursor paging: OpenAlex answers with `next_cursor`, which the page schema reads, and DOIs that share works can
		// fill more than one page.
		for (let cursor: string | null = "*"; cursor; ) {
			const url = worksUrl({ filter: `doi:${dois.join("|")}` }, cursor, OPENALEX_MAX_PAGE_SIZE, this.options.apiKey);
			url.searchParams.set("select", "doi,open_access");
			const page = openAlexPageSchema.parse(await this.read(url, undefined));
			addOpenAccess(open, page.results);
			cursor = page.results.length > 0 ? page.meta.next_cursor : null;
		}
		return open;
	}

	/**
	 * Where OpenAlex places each institution, for 1 to `OPENALEX_MAX_IDS_PER_FILTER` ids such as "I40120149": its coordinates
	 * and city. An institution OpenAlex does not know, or places nowhere, is left out.
	 */
	async institutionLocations(ids: readonly string[]) {
		if (!ids.length || ids.length > OPENALEX_MAX_IDS_PER_FILTER) {
			throw new Error(`An OpenAlex institution filter takes 1 to ${OPENALEX_MAX_IDS_PER_FILTER} ids`);
		}
		// The engine's key must not reach OpenAlex, and the engine doesn't place institutions.
		if (readSearchEngineAccess(this.options.apiKey)) return new Map();
		const url = new URL("https://api.openalex.org/institutions");
		url.searchParams.set("filter", `openalex:${ids.join("|")}`);
		url.searchParams.set("select", "id,geo");
		url.searchParams.set("per_page", String(OPENALEX_MAX_IDS_PER_FILTER));
		url.searchParams.set("api_key", this.options.apiKey);
		const { results } = openAlexInstitutionLocationsSchema.parse(await this.read(url, undefined));
		return new Map(results.flatMap(({ id, geo }) =>
			geo?.latitude == null || geo.longitude == null ? [] : [[id.split("/").pop()!, { latitude: geo.latitude, longitude: geo.longitude, city: geo.city?.trim() || null }] as const]));
	}

	/**
	 * One page of the query's works; "*" asks for the first. OpenAlex leaves
	 * `next_cursor` out without a cursor. A caller that follows `next_cursor`
	 * can take a smaller page than it asked for when OpenAlex's search times
	 * out; any other caller always gets the size it asked for. A short page
	 * that would end a followed cursor early is asked for again first.
	 */
	async works(query: OpenAlexQuery, cursor: string, pageSize = 100, { followsCursor = false } = {}) {
		let size = followsCursor ? Math.min(pageSize, this.pageLimit) : pageSize;
		for (;;) {
			let page: OpenAlexPage;
			try {
				page = await this.page(query, cursor, size, followsCursor && size > MIN_PAGE_SIZE);
			} catch (error) {
				if (!(error instanceof OpenAlexSearchTimeoutError)) throw error;
				size = this.shrink(size);
				continue;
			}
			this.countPage(size);
			return followsCursor ? this.checkLastPage(query, cursor, size, page) : page;
		}
	}

	private async page(query: OpenAlexQuery, cursor: string, size: number, canShrink = false) {
		const page = openAlexPageSchema.parse(await this.read(worksUrl(query, cursor, size, this.options.apiKey), query.oql, canShrink));
		if (page.results.length > size) throw new OpenAlexApiError("OpenAlex returned more works than requested");
		return readSearchEngineAccess(this.options.apiKey) ? this.asOpenAlexPage(page) : page;
	}

	/** The engine's page in OpenAlex's terms: one work per OpenAlex id, as the engine can hold a paper twice, and none OpenAlex doesn't hold. */
	private asOpenAlexPage(page: OpenAlexPage): OpenAlexPage {
		const works = new Map<string, unknown>();
		for (const work of page.results.map(asOpenAlexWork)) {
			if (work && !works.has(work.id)) works.set(work.id, work);
		}
		const skipped = page.results.length - works.size;
		if (skipped) console.warn("Engine works left out: no OpenAlex id, or a second work under one", { skipped });
		return { ...page, results: [...works.values()] };
	}

	/**
	 * Asks for a short last page again; an answer with a cursor or more works
	 * replaces it. A search timeout asks again at a smaller size, as `works` does.
	 */
	private async checkLastPage(query: OpenAlexQuery, cursor: string, size: number, page: OpenAlexPage) {
		let askedSize = size;
		for (let check = 1; check <= LAST_PAGE_CHECKS && endsEarly(page, askedSize); ) {
			await this.sleep(1_000 * check);
			let again: OpenAlexPage;
			try {
				again = await this.page(query, cursor, size, size > MIN_PAGE_SIZE);
			} catch (error) {
				if (!(error instanceof OpenAlexSearchTimeoutError)) throw error;
				size = this.shrink(size);
				continue;
			}
			check++;
			if (!again.meta.next_cursor && again.results.length <= page.results.length) continue;
			console.warn("OpenAlex cut a page short; asking again found more", {
				pageSize: size,
				works: page.results.length,
				worksAgain: again.results.length,
				nextCursor: Boolean(again.meta.next_cursor),
				count: again.meta.count,
			});
			page = again;
			askedSize = size;
		}
		return page;
	}

	/** The next size to ask for after a search timeout at `size`, or the shared limit if another page already lowered it further. */
	private shrink(size: number) {
		const smaller = Math.max(MIN_PAGE_SIZE, Math.ceil(size / 2));
		this.pageLimit = Math.min(this.pageLimit, smaller);
		this.pagesAtLimit = 0;
		console.warn("OpenAlex search timed out; asking for fewer works a page", { pageSize: this.pageLimit });
		return this.pageLimit;
	}

	/** Only a page asked for at the current limit counts toward raising it. */
	private countPage(size: number) {
		if (size !== this.pageLimit || size >= OPENALEX_MAX_PAGE_SIZE) return;
		if (++this.pagesAtLimit < PAGES_BEFORE_GROWING) return;
		this.pageLimit = Math.min(OPENALEX_MAX_PAGE_SIZE, this.pageLimit * 2);
		this.pagesAtLimit = 0;
	}

	private async read(url: URL, oql: string | undefined, canShrink = false): Promise<unknown> {
		const response = await this.fetchWithRetries(url, oql, canShrink);
		const bytes = await readBoundedResponse(
			response,
			response.ok
				? (this.options.maxResponseBytes ?? 64 * 1024 * 1024)
				: 8_192,
			30_000,
			30_000,
			(message, status) => new OpenAlexApiError(message, status),
		);
		const body = new TextDecoder().decode(bytes);
		if (!response.ok)
			throw new OpenAlexApiError(
				`OpenAlex works returned ${response.status}: ${body}`,
				response.status,
			);
		return JSON.parse(body);
	}
}
