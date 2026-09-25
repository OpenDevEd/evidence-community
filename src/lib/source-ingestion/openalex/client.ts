import { readBoundedResponse } from "../read-bounded-response";
import {
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

export class OpenAlexClient {
	constructor(
		private readonly options: {
			apiKey: string;
			fetch?: typeof fetch;
			sleep?: (milliseconds: number) => Promise<void>;
			maxResponseBytes?: number;
		},
	) {}

	async works(query: OpenAlexQuery, cursor: string, pageSize = 100) {
		if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
			throw new Error("OpenAlex pageSize must be between 1 and 100");
		}
		const approved = openAlexQuerySchema.parse(query);
		const url = new URL("https://api.openalex.org/works");
		for (const [key, value] of Object.entries(approved)) {
			if (value) url.searchParams.set(key, value);
		}
		url.searchParams.set("cursor", cursor);
		url.searchParams.set("per_page", String(pageSize));
		url.searchParams.set("api_key", this.options.apiKey);
		const request = this.options.fetch ?? fetch;
		const sleep =
			this.options.sleep ??
			((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
		for (let attempt = 0; attempt < 4; attempt++) {
			let response: Response;
			try {
				response = await request(url, {
					headers: { Accept: "application/json" },
					redirect: "error",
					signal: AbortSignal.timeout(30_000),
				});
			} catch (error) {
				if (attempt === 3)
					throw new OpenAlexApiError(
						`OpenAlex works request failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				await sleep(250 * 2 ** attempt);
				continue;
			}
			if (
				(response.status === 429 || response.status >= 500) &&
				attempt < 3
			) {
				await response.body?.cancel();
				const retryAfter = response.headers.get("retry-after");
				const seconds = Number(retryAfter);
				const requestedDelay = Number.isFinite(seconds)
					? seconds * 1000
					: Date.parse(retryAfter ?? "") - Date.now();
				await sleep(
					Math.min(
						60_000,
						Math.max(250 * 2 ** attempt, requestedDelay || 0),
					),
				);
				continue;
			}
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
			const page = openAlexPageSchema.parse(JSON.parse(body));
			if (page.results.length > pageSize) {
				throw new OpenAlexApiError(
					"OpenAlex returned more works than requested",
				);
			}
			return page;
		}
		throw new OpenAlexApiError("OpenAlex works request exhausted retries");
	}
}
