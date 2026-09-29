import { readBoundedResponse } from "../read-bounded-response";
import {
	OPENALEX_MAX_PAGE_SIZE,
	openAlexGroupsSchema,
	openAlexPageSchema,
	openAlexQuerySchema,
	type OpenAlexQuery,
} from "./schema";

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

function retryDelay(response: Response, attempt: number) {
	const retryAfter = response.headers.get("retry-after");
	const seconds = Number(retryAfter);
	const requestedDelay = Number.isFinite(seconds)
		? seconds * 1000
		: Date.parse(retryAfter ?? "") - Date.now();
	return Math.min(60_000, Math.max(1_000 * 2 ** attempt, requestedDelay || 0));
}

export class OpenAlexClient {
	constructor(
		private readonly options: {
			apiKey: string;
			fetch?: typeof fetch;
			sleep?: (milliseconds: number) => Promise<void>;
			maxResponseBytes?: number;
		},
	) {}

	private async fetchWithRetries(url: URL, oql?: string) {
		const init = requestInit(oql);
		const request = this.options.fetch ?? fetch;
		const sleep =
			this.options.sleep ??
			((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
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
				await sleep(1_000 * 2 ** attempt);
				continue;
			}
			if (!isRetryable(response, attempt)) return response;
			await response.body?.cancel();
			await sleep(retryDelay(response, attempt));
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

	async works(query: OpenAlexQuery, cursor: string, pageSize = 100) {
		const url = worksUrl(query, cursor, pageSize, this.options.apiKey);
		const page = openAlexPageSchema.parse(await this.read(url, query.oql));
		if (page.results.length > pageSize) {
			throw new OpenAlexApiError(
				"OpenAlex returned more works than requested",
			);
		}
		return page;
	}

	private async read(url: URL, oql: string | undefined): Promise<unknown> {
		const response = await this.fetchWithRetries(url, oql);
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
