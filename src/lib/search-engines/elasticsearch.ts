import type { estypes } from "@elastic/elasticsearch";

import type { SearchService } from "@/lib/elasticsearch-factory";
import type { SearchAnswer, SearchEngine, SearchRequest } from "@/lib/search-engine";

import { facetAggregations, facetDistribution, searchQuery, sortClauses } from "./elasticsearch-query";

/** Elasticsearch answers no page that ends past this many results; a deeper page is read from a point in time. */
const RESULT_WINDOW = 10_000;

/** Results one request of a deep read takes. */
const DEEP_PAGE_SIZE = 5_000;

function returnedSource(returned: SearchRequest["returned"]): estypes.SearchSourceConfig | undefined {
	if (!returned) return undefined;
	return "only" in returned ? [...returned.only] : { excludes: [...returned.except] };
}

/** A results page read backwards: the one before a place, or the last one. */
function readsBackwards(request: SearchRequest) {
	return request.before !== undefined || request.fromEnd === true;
}

function searchBody(request: SearchRequest): Omit<estypes.SearchRequest, "index"> {
	const place = request.after ?? request.before;
	const source = returnedSource(request.returned);
	return {
		size: request.size,
		query: searchQuery(request.text, request.fields, request.filters, request.sort),
		sort: sortClauses(request.sort, { text: request.text, reverse: readsBackwards(request) }),
		track_total_hits: request.exactTotal ?? true,
		...(place ? { search_after: [...place] } : request.fromEnd ? {} : { from: request.from ?? 0 }),
		...(source === undefined ? {} : { _source: source }),
		...(request.facets?.length ? { aggs: facetAggregations(request.facets) } : {}),
	};
}

function totalOf(response: { hits: { total?: number | estypes.SearchTotalHits } }) {
	const total = response.hits.total;
	return typeof total === "number" ? total : (total?.value ?? 0);
}

function answerOf<T>(request: SearchRequest, response: estypes.SearchResponse<T>): SearchAnswer<T> {
	const hits = readsBackwards(request) ? [...response.hits.hits].reverse() : response.hits.hits;
	return {
		hits: hits.map((hit) => hit._source as T),
		total: totalOf(response),
		facets: facetDistribution(response.aggregations),
		first: hits[0]?.sort ?? null,
		last: hits.at(-1)?.sort ?? null,
	};
}

/** One request of a deep read: the first counts the results and any facets, the rest continue after `after`. */
function deepPageBody(request: SearchRequest, size: number, after: estypes.SortResults | undefined): Omit<estypes.SearchRequest, "index"> {
	const source = returnedSource(request.returned);
	return {
		size,
		query: searchQuery(request.text, request.fields, request.filters, request.sort),
		sort: sortClauses(request.sort, { text: request.text }),
		track_total_hits: after === undefined,
		...(after ? { search_after: after } : {}),
		...(source === undefined ? {} : { _source: source }),
		...(after === undefined && request.facets?.length ? { aggs: facetAggregations(request.facets) } : {}),
	};
}

/** Whether a page ends past the result window, counted from the first result. */
function pastResultWindow(request: SearchRequest) {
	return !request.after && !request.before && !request.fromEnd && (request.from ?? 0) + request.size > RESULT_WINDOW;
}

/** A library's search in the shared Elasticsearch, through its alias and login (OpenDevEd/new-el#721). */
export function elasticsearchEngine({ alias, client }: SearchService): SearchEngine {
	/**
	 * `count` results from `offset` on, however deep, read from one point in time of the index, so writes and a
	 * rebuild meanwhile don't change what comes back; and the answer to the first request, which counted them.
	 */
	async function readDeep<T>(request: SearchRequest, offset: number, count: number, signal?: AbortSignal) {
		const pit = await client.openPointInTime({ index: alias, keep_alive: "2m" }, { signal });
		try {
			const hits: Array<estypes.SearchHit<T>> = [];
			let counted: estypes.SearchResponse<T> | undefined;
			while (hits.length < offset + count) {
				signal?.throwIfAborted();
				const size = Math.min(DEEP_PAGE_SIZE, offset + count - hits.length);
				const response = await client.search<T>(
					{ pit: { id: pit.id, keep_alive: "2m" }, ...deepPageBody(request, size, hits.at(-1)?.sort) },
					{ signal },
				);
				counted ??= response;
				hits.push(...response.hits.hits);
				if (response.hits.hits.length < size) break;
			}
			return { hits: hits.slice(offset, offset + count), counted: counted! };
		} finally {
			await client.closePointInTime({ id: pit.id }).catch(() => undefined);
		}
	}

	return {
		name: "elasticsearch",
		async search<T>(request: SearchRequest) {
			if (!pastResultWindow(request)) return answerOf(request, await client.search<T>({ index: alias, ...searchBody(request) }));
			const { hits, counted } = await readDeep<T>(request, request.from ?? 0, request.size);
			// A point in time adds its own tiebreaker to each place; a cursor holds only the order's values.
			const placeLength = sortClauses(request.sort, { text: request.text }).length;
			return {
				hits: hits.map((hit) => hit._source as T),
				total: totalOf(counted),
				facets: facetDistribution(counted.aggregations),
				first: hits[0]?.sort?.slice(0, placeLength) ?? null,
				last: hits.at(-1)?.sort?.slice(0, placeLength) ?? null,
			};
		},
		async searchMany<T>(requests: readonly SearchRequest[]) {
			if (requests.length === 0) return [];
			const { responses } = await client.msearch<T>({ index: alias, searches: requests.flatMap((request) => [{}, searchBody(request)]) });
			return responses.map((response, position) => {
				if ("error" in response) throw new Error(`Elasticsearch multi-search failed: ${JSON.stringify(response.error).slice(0, 500)}`);
				return answerOf(requests[position]!, response);
			});
		},
		async read<T>(key: string, except: readonly string[]) {
			const response = await client.get<T>({ index: alias, id: key, _source_excludes: [...except] }, { ignore: [404] });
			return response.found ? (response._source ?? null) : null;
		},
		/** Read from one point in time of the index, so writes and a rebuild meanwhile don't change what comes back. */
		async keys(request: SearchRequest, offset: number, count: number, signal: AbortSignal) {
			const keyed = { ...request, returned: { only: ["key"] }, facets: undefined };
			const { hits, counted } = await readDeep<{ key: string }>(keyed, offset, count, signal);
			return { keys: hits.map((hit) => String(hit._source?.key)), total: totalOf(counted) };
		},
	};
}
