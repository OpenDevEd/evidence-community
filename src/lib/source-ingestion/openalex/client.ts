import { readBoundedResponse } from "../read-bounded-response";
import {
	OPENALEX_MAX_PAGE_SIZE,
	openAlexGroupsSchema,
	openAlexPageSchema,
	openAlexQuerySchema,
	type OpenAlexPage,
	type OpenAlexQuery,
} from "./schema";

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
	// OQL runs at the API root with the query in the POST body.
	const url = new URL(
		approved.oql ? "https://api.openalex.org/" : "https://api.openalex.org/works",
	);
	for (const key of ["filter", "search"] as const) {
		if (approved[key]) url.searchParams.set(key, approved[key]);
	}
	if (cursor) url.searchParams.set("cursor", cursor);
	url.searchParams.set("per_page", String(pageSize));
	url.searchParams.set("api_key", apiKey);
	return url;
}

/** OQL goes in a POST body, since it outgrows a URL. */
function requestInit(oql: string | undefined): RequestInit {
	if (!oql) return { headers: { Accept: "application/json" } };
	return {
		method: "POST",
		body: JSON.stringify({ oql }),
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
	};
}

// A long import makes thousands of requests, so a network blip of up to half a minute is waited out.
const MAX_ATTEMPTS = 6;

function isRetryable(response: Response, attempt: number) {
	return (response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS - 1;
}

function failureText(error: unknown) {
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

function retryDelay(response: Response, attempt: number) {
	const retryAfter = response.headers.get("retry-after");
	const seconds = Number(retryAfter);
	const requestedDelay = Number.isFinite(seconds)
		? seconds * 1000
		: Date.parse(retryAfter ?? "") - Date.now();
	return Math.min(60_000, Math.max(1_000 * 2 ** attempt, requestedDelay || 0));
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
		const init = requestInit(oql);
		const request = this.options.fetch ?? fetch;
		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			let response: Response;
			try {
				response = await request(url, {
					...init,
					redirect: "error",
					signal: AbortSignal.timeout(30_000),
				});
			} catch (error) {
				if (attempt === MAX_ATTEMPTS - 1)
					throw new OpenAlexApiError(`OpenAlex works request failed: ${failureText(error)}`);
				await this.sleep(1_000 * 2 ** attempt);
				continue;
			}
			if (canShrink) response = await throwIfSearchTimeout(response);
			if (!isRetryable(response, attempt)) return response;
			await response.body?.cancel();
			await this.sleep(retryDelay(response, attempt));
		}
		throw new OpenAlexApiError("OpenAlex works request exhausted retries");
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
		return page;
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
