import type { estypes } from "@elastic/elasticsearch";

import type { SearchService } from "@/lib/elasticsearch-factory";
import type { Embedder } from "@/lib/embedder";
import { SearchMeaningUnavailableError, type SearchAnswer, type SearchEngine, type SearchRequest } from "@/lib/search-engine";

import { facetAggregations, facetDistribution, filterClause, searchQuery, sortClauses } from "./elasticsearch-query";
import { fuseRanks } from "./rank-fusion";

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

/** How deep the words and the meaning orders are read to mix them: a page's records come from at least this many of each. */
const MIXED_DEPTH = 50;

/** How long a reader's search waits for the embedder before words alone rank it. */
const QUERY_EMBED_TIMEOUT_MS = 3_000;
/** After the embedder fails a reader's search, searches skip it this long, so an outage costs one wait, not each. */
const QUERY_EMBED_PAUSE_MS = 30_000;
/** When each embedder, by fingerprint, may be asked again after it failed a reader's search. */
const pausedEmbedders = new Map<string, number>();

/**
 * Whether words and meaning rank the results together: only from the first result, which a mixed answer starts at.
 * A cursor or a page past the result window ranks by words alone. A chosen order still mixes them, as Meilisearch's
 * hybrid search does: the words order ranks by relevance first and the chosen order breaks its ties.
 */
function mixesMeaning(request: SearchRequest) {
	const fromStart = !request.after && !request.before && !request.fromEnd && !pastResultWindow(request);
	return Boolean(request.semantic && request.semantic.ratio > 0 && fromStart);
}

/** A vector, and the embedder fingerprint of the vectors it can be compared with. */
type Meaning = { vector: number[]; model: string };

/** The records nearest a vector by angle, among those made by the same embedder, that pass the request's filters. */
function nearestBody(request: SearchRequest, meaning: Meaning, depth: number): Omit<estypes.SearchRequest, "index"> {
	const filter = [...request.filters.map(filterClause), { term: { embeddingModel: meaning.model } }];
	return {
		size: depth,
		knn: { field: "embedding", query_vector: meaning.vector, k: depth, num_candidates: Math.min(10_000, Math.max(100, depth * 2)), filter },
		...returnedFields(request.returned),
	};
}

/** A hit's record key: its `_id`, or for keys alone, which load no `_id`, the key's doc value. */
function keyOf(hit: estypes.SearchHit<unknown>) {
	return hit._id ?? String((hit.fields?.key as string[] | undefined)?.[0]);
}

/** Records by key, the first answer that holds each. */
function recordsByKey<T>(...pages: Array<Array<estypes.SearchHit<T>>>) {
	const records = new Map<string, T>();
	for (const hit of pages.flat()) if (!records.has(keyOf(hit))) records.set(keyOf(hit), recordOf(hit));
	return records;
}

type MultiSearchAnswer<T> = estypes.MsearchResponseItem<T> | undefined;

/** One search of a multi-search, which fails the whole search when it failed. */
function answered<T>(response: MultiSearchAnswer<T>) {
	if (!response || "error" in response) throw new Error(`Elasticsearch search failed: ${JSON.stringify(response?.error).slice(0, 500)}`);
	return response;
}

/** The nearest records, or none when they couldn't be read, as before any record has a vector. */
function nearestHits<T>(response: MultiSearchAnswer<T>) {
	if (response && !("error" in response)) return response.hits.hits;
	console.warn(`Search: the nearest records couldn't be read, so words alone rank the results. ${JSON.stringify(response?.error).slice(0, 500)}`);
	return [];
}

/** The page of the words and nearest orders mixed, `ratio` of the way to meaning; it has no cursor. */
function mixedAnswer<T>(request: SearchRequest, words: estypes.SearchResponse<T>, nearest: Array<estypes.SearchHit<T>>): SearchAnswer<T> {
	const from = request.from ?? 0;
	const ratio = request.semantic?.ratio ?? 0;
	const order = fuseRanks([
		{ weight: 1 - ratio, keys: words.hits.hits.map(keyOf) },
		{ weight: ratio, keys: nearest.map(keyOf) },
	]);
	const records = recordsByKey(words.hits.hits, nearest);
	return {
		hits: order.slice(from, from + request.size).map((key) => records.get(key)!),
		total: Math.max(totalOf(words), order.length),
		facets: facetDistribution(words.aggregations),
		first: null,
		last: null,
	};
}

/**
 * A library's search in the shared Elasticsearch, through its alias and login (OpenDevEd/new-el#721), ranking by
 * meaning with the library's `embedder` when a request asks (OpenDevEd/new-el#720).
 */
export function elasticsearchEngine({ alias, client }: SearchService, embedder: Embedder | null = null): SearchEngine {
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

	async function searchByWords<T>(request: SearchRequest): Promise<SearchAnswer<T>> {
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
	}

	/** A record's stored vector and the embedder that made it; it has none until the worker embeds it. */
	async function storedMeaning(key: string, signal?: AbortSignal): Promise<Meaning> {
		const response = await client.search<{ embedding?: unknown; embeddingModel?: string }>(
			// Elasticsearch leaves vectors out of the records it sends back unless asked.
			{ index: alias, size: 1, query: { ids: { values: [key] } }, _source: { includes: ["embedding", "embeddingModel"], exclude_vectors: false } as estypes.SearchSourceConfig },
			{ signal },
		);
		const stored = response.hits.hits[0]?._source;
		if (!Array.isArray(stored?.embedding) || !stored.embeddingModel) throw new SearchMeaningUnavailableError(key);
		return { vector: stored.embedding as number[], model: stored.embeddingModel };
	}

	/** The text's vector, or null when the embedder fails or doesn't answer in time, or failed a moment ago. */
	async function textMeaning(model: Embedder, text: string, signal?: AbortSignal): Promise<Meaning | null> {
		if (Date.now() < (pausedEmbedders.get(model.fingerprint) ?? 0)) return null;
		const deadline = AbortSignal.timeout(QUERY_EMBED_TIMEOUT_MS);
		try {
			const [vector] = await model.embed([text], signal ? AbortSignal.any([signal, deadline]) : deadline);
			return vector ? { vector, model: model.fingerprint } : null;
		} catch (error) {
			signal?.throwIfAborted();
			pausedEmbedders.set(model.fingerprint, Date.now() + QUERY_EMBED_PAUSE_MS);
			console.warn(`Search: the embedder failed, so words alone rank searches for ${QUERY_EMBED_PAUSE_MS / 1_000} s. ${error instanceof Error ? error.message : String(error)}`);
			return null;
		}
	}

	/** The vector to search by: the record's own, or the text's from the embedder; null to rank by words alone. */
	async function meaningOf(request: SearchRequest) {
		if (request.semantic?.like) return storedMeaning(request.semantic.like, request.signal);
		return embedder && request.text.trim() ? textMeaning(embedder, request.text, request.signal) : null;
	}

	/**
	 * Words and meaning together, as Meilisearch's hybrid search ranks them: a search by words and one for the nearest
	 * vectors, with the same filters, in one request, mixed by reciprocal rank fusion with `ratio` going to meaning.
	 * Without a vector, or when the nearest can't be read, words alone rank them.
	 */
	async function searchMixed<T>(request: SearchRequest): Promise<SearchAnswer<T>> {
		const byWords = { ...request, semantic: undefined };
		const meaning = await meaningOf(request);
		if (!meaning) return searchByWords<T>(byWords);
		const from = request.from ?? 0;
		const depth = Math.max(MIXED_DEPTH, from + request.size);
		const searches = [{}, searchBody({ ...byWords, from: 0, size: depth }), {}, nearestBody(request, meaning, depth)];
		const [words, nearest] = (await client.msearch<T>({ index: alias, searches }, { signal: request.signal })).responses;
		return mixedAnswer(request, answered(words), nearestHits(nearest));
	}

	const search = <T>(request: SearchRequest) => (mixesMeaning(request) ? searchMixed<T>(request) : searchByWords<T>(request));

	return {
		name: "elasticsearch",
		search,
		async searchMany<T>(requests: readonly SearchRequest[]) {
			if (requests.length === 0) return [];
			if (requests.some(mixesMeaning)) return Promise.all(requests.map((request) => search<T>(request)));
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
