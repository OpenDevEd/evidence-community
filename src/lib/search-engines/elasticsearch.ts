import type { estypes } from "@elastic/elasticsearch";

import type { SearchService } from "@/lib/elasticsearch-factory";
import type { SearchAnswer, SearchEngine, SearchRequest } from "@/lib/search-engine";

import { facetAggregations, facetDistribution, searchQuery, sortClauses } from "./elasticsearch-query";

/** Elasticsearch answers no page that ends past this many results; a deeper page is read from a point in time. */
const RESULT_WINDOW = 10_000;

/** Results one request of a deep read takes: the most Elasticsearch answers at once. */
const DEEP_PAGE_SIZE = 10_000;

/** A request for record keys alone, which Elasticsearch reads from its doc values, not each record's stored copy. */
function keysOnly(returned: SearchRequest["returned"]) {
	return Boolean(returned && "only" in returned && returned.only.length === 1 && returned.only[0] === "key");
}

/**
 * The fields to send back: from the stored copy, or for keys alone, from the key's doc values. Loading no stored
 * field at all, not even `_id`, saves unpacking each record: a page of 10,000 keys takes 53 ms on AIED, not 610.
 */
function returnedFields(returned: SearchRequest["returned"]): Pick<estypes.SearchRequest, "_source" | "docvalue_fields" | "stored_fields"> {
	if (keysOnly(returned)) return { _source: false, stored_fields: "_none_", docvalue_fields: ["key"] };
	if (!returned) return {};
	return { _source: "only" in returned ? [...returned.only] : { excludes: [...returned.except] } };
}

/** One hit as the record the request asked for. */
function recordOf<T>(hit: estypes.SearchHit<T>): T {
	return hit._source ?? ({ key: (hit.fields?.key as string[] | undefined)?.[0] } as T);
}

/** A results page read backwards: the one before a place, or the last one. */
function readsBackwards(request: SearchRequest) {
	return request.before !== undefined || request.fromEnd === true;
}

function searchBody(request: SearchRequest): Omit<estypes.SearchRequest, "index"> {
	const place = request.after ?? request.before;
	return {
		size: request.size,
		query: searchQuery(request.text, request.fields, request.filters, request.sort),
		sort: sortClauses(request.sort, { text: request.text, reverse: readsBackwards(request) }),
		track_total_hits: request.exactTotal ?? true,
		...(place ? { search_after: [...place] } : request.fromEnd ? {} : { from: request.from ?? 0 }),
		...returnedFields(request.returned),
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
		hits: hits.map(recordOf),
		total: totalOf(response),
		facets: facetDistribution(response.aggregations),
		first: hits[0]?.sort ?? null,
		last: hits.at(-1)?.sort ?? null,
	};
}

/** One request of a deep read: the first counts the results and any facets, the rest continue after `after`. */
function deepPageBody(request: SearchRequest, size: number, after: estypes.SortResults | undefined): Omit<estypes.SearchRequest, "index"> {
	return {
		size,
		query: searchQuery(request.text, request.fields, request.filters, request.sort),
		sort: sortClauses(request.sort, { text: request.text }),
		track_total_hits: after === undefined,
		...(after ? { search_after: after } : {}),
		...returnedFields(request.returned),
		...(after === undefined && request.facets?.length ? { aggs: facetAggregations(request.facets) } : {}),
	};
}

type Kept<T> = { records: T[]; first?: estypes.SortResults; last?: estypes.SortResults };

/** Keeps a deep read's records from `skip` on in one page, and the places of the first and last it keeps. */
function keepPage<T>(kept: Kept<T>, page: Array<estypes.SearchHit<T>>, skip: number) {
	const wanted = page.slice(skip);
	if (wanted.length === 0) return;
	kept.first ??= wanted[0]!.sort;
	kept.last = wanted.at(-1)!.sort;
	kept.records.push(...wanted.map(recordOf));
}

/** Whether a page ends past the result window, counted from the first result. */
function pastResultWindow(request: SearchRequest) {
	return !request.after && !request.before && !request.fromEnd && (request.from ?? 0) + request.size > RESULT_WINDOW;
}

/** A library's search in the shared Elasticsearch, through its alias and login (OpenDevEd/new-el#721). */
export function elasticsearchEngine({ alias, client }: SearchService): SearchEngine {
	/**
	 * `count` results from `offset` on, however deep, read from one point in time of the index, so writes and a
	 * rebuild meanwhile don't change what comes back: their records, the places of the first and last, and the answer
	 * to the first request, which counted them. It keeps only the records it returns.
	 */
	async function readDeep<T>(request: SearchRequest, offset: number, count: number, signal?: AbortSignal) {
		const pit = await client.openPointInTime({ index: alias, keep_alive: "2m" }, { signal });
		try {
			const kept: Kept<T> = { records: [] };
			let read = 0;
			let after: estypes.SortResults | undefined;
			let counted: estypes.SearchResponse<T> | undefined;
			while (read < offset + count) {
				signal?.throwIfAborted();
				const size = Math.min(DEEP_PAGE_SIZE, offset + count - read);
				const response = await client.search<T>({ pit: { id: pit.id, keep_alive: "2m" }, ...deepPageBody(request, size, after) }, { signal });
				counted ??= response;
				const page = response.hits.hits;
				keepPage(kept, page, Math.max(0, offset - read));
				read += page.length;
				after = page.at(-1)?.sort;
				// The first answer counted every result, so a read starting past them stops there.
				if (page.length < size || offset >= totalOf(counted)) break;
			}
			return { ...kept, counted: counted! };
		} finally {
			await client.closePointInTime({ id: pit.id }).catch(() => undefined);
		}
	}

	return {
		name: "elasticsearch",
		async search<T>(request: SearchRequest) {
			const signal = request.signal;
			if (!pastResultWindow(request)) return answerOf(request, await client.search<T>({ index: alias, ...searchBody(request) }, { signal }));
			const { records, first, last, counted } = await readDeep<T>(request, request.from ?? 0, request.size, signal);
			// A point in time adds its own tiebreaker to each place; a cursor holds only the order's values.
			const placeLength = sortClauses(request.sort, { text: request.text }).length;
			return {
				hits: records,
				total: totalOf(counted),
				facets: facetDistribution(counted.aggregations),
				first: first?.slice(0, placeLength) ?? null,
				last: last?.slice(0, placeLength) ?? null,
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
			const { records, counted } = await readDeep<{ key: string }>(keyed, offset, count, signal);
			return { keys: records.map((record) => String(record.key)), total: totalOf(counted) };
		},
	};
}
