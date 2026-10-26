import type { estypes } from "@elastic/elasticsearch";

import type { SearchService } from "@/lib/elasticsearch-factory";
import type { SearchAnswer, SearchEngine, SearchRequest } from "@/lib/search-engine";

import { facetAggregations, facetDistribution, searchQuery, sortClauses } from "./elasticsearch-query";

/** Keys one page of a deep key walk reads at once. */
const KEYS_PER_PAGE = 500;

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

/** A library's search in the shared Elasticsearch, through its alias and login (OpenDevEd/new-el#721). */
export function elasticsearchEngine({ alias, client }: SearchService): SearchEngine {
	return {
		name: "elasticsearch",
		async search<T>(request: SearchRequest) {
			return answerOf(request, await client.search<T>({ index: alias, ...searchBody(request) }));
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
			const pit = await client.openPointInTime({ index: alias, keep_alive: "2m" }, { signal });
			try {
				const keys: string[] = [];
				let total = 0;
				let after: estypes.SortResults | undefined;
				while (keys.length < offset + count) {
					signal.throwIfAborted();
					const size = Math.min(KEYS_PER_PAGE, offset + count - keys.length);
					const response = await client.search<{ key: string }>({
						pit: { id: pit.id, keep_alive: "2m" },
						size,
						query: searchQuery(request.text, request.fields, request.filters, request.sort),
						sort: sortClauses(request.sort, { text: request.text }),
						_source: ["key"],
						track_total_hits: after === undefined,
						...(after ? { search_after: after } : {}),
					}, { signal });
					if (after === undefined) total = totalOf(response);
					keys.push(...response.hits.hits.map((hit) => String(hit._source?.key)));
					if (response.hits.hits.length < size) break;
					after = response.hits.hits.at(-1)!.sort;
				}
				return { keys: keys.slice(offset, offset + count), total };
			} finally {
				await client.closePointInTime({ id: pit.id }).catch(() => undefined);
			}
		},
	};
}
