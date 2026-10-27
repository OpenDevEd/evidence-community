import { describe, expect, it, vi } from "vitest";

import { SearchMeaningUnavailableError } from "@/lib/search-engine";
import { elasticsearchEngine } from "@/lib/search-engines/elasticsearch";

/** An index of `count` records, sorted by key, that answers point-in-time pages after a place. */
function index(count: number) {
	const keys = Array.from({ length: count }, (_, position) => `KEY${String(position).padStart(6, "0")}`);
	const client = {
		openPointInTime: vi.fn(async () => ({ id: "pit-1" })),
		closePointInTime: vi.fn(async () => ({})),
		search: vi.fn(async (body: { size: number; search_after?: [string, number]; from?: number; aggs?: object; docvalue_fields?: string[] }) => {
			const start = body.search_after ? keys.indexOf(body.search_after[0]) + 1 : (body.from ?? 0);
			const page = keys.slice(start, start + body.size);
			return {
				hits: {
					total: { value: keys.length, relation: "eq" },
					// A point in time adds its own tiebreaker to each place.
					// Asked for keys alone, Elasticsearch reads them from doc values and sends no stored copy.
					hits: page.map((key, position) => ({ ...(body.docvalue_fields ? { fields: { key: [key] } } : { _source: { key } }), sort: [key, start + position] })),
				},
				...(body.aggs ? { aggregations: { year: { buckets: [{ key: 2024, doc_count: count }] } } } : {}),
			};
		}),
	};
	return { client, engine: elasticsearchEngine({ alias: "library", client: client as never }) };
}

const request = { text: "", fields: [], filters: [], returned: { only: ["key"] } };

describe("a search in Elasticsearch", () => {
	it("reads a page that ends within the result window in one request", async () => {
		const { client, engine } = index(12_000);
		const answer = await engine.search({ ...request, size: 20, from: 9_980 });
		expect(client.openPointInTime).not.toHaveBeenCalled();
		expect(answer.hits).toHaveLength(20);
	});

	it("reads a page past the result window from one point in time, counting and faceting once", async () => {
		const { client, engine } = index(12_345);
		const answer = await engine.search<{ key: string }>({ ...request, size: 300_000, facets: ["year"] });
		expect(answer.hits).toHaveLength(12_345);
		expect(answer.total).toBe(12_345);
		expect(answer.facets).toEqual({ year: { "2024": 12_345 } });
		// The cursor places hold the order's values, not the point in time's tiebreaker.
		expect(answer.last).toEqual(["KEY012344"]);
		expect(client.search.mock.calls.map(([body]) => Boolean(body.aggs))).toEqual([true, false]);
		expect(client.search.mock.calls[0]![0]).toMatchObject({ _source: false, stored_fields: "_none_", docvalue_fields: ["key"] });
		expect(client.closePointInTime).toHaveBeenCalledWith({ id: "pit-1" });
	});
});

describe("a deep key walk in Elasticsearch", () => {
	it("reads every key from an offset, and the total", async () => {
		const { engine } = index(7_000);
		const { keys, total } = await engine.keys({ ...request, size: 0 }, 5_998, 1_500, new AbortController().signal);
		expect(keys).toEqual(["KEY005998", "KEY005999", ...Array.from({ length: 1_000 }, (_, position) => `KEY${String(6_000 + position).padStart(6, "0")}`)]);
		expect(total).toBe(7_000);
	});
});

describe("a deep read that starts past every result", () => {
	it("stops after the first request, which counted them", async () => {
		const { client, engine } = index(30);
		expect(await engine.keys({ ...request, size: 0 }, 50_000, 10, new AbortController().signal)).toEqual({ keys: [], total: 30 });
		expect(client.search).toHaveBeenCalledTimes(1);
	});
});

/**
 * An index whose words search answers `words` and whose nearest-vector search answers `nearest`, by key. Asked for keys
 * alone, it sends them as doc values without `_id`, as Elasticsearch does.
 */
function mixed(words: string[], nearest: string[], stored: Record<string, number[]> = {}, fingerprint = "model") {
	const hits = (keys: string[]) => ({ hits: { total: { value: keys.length, relation: "eq" }, hits: keys.map((key) => ({ fields: { key: [key] } })) } });
	const client = {
		search: vi.fn(async (body: { query: { ids?: { values: string[] } } }) => {
			const key = body.query.ids?.values[0];
			return key ? { hits: { hits: stored[key] ? [{ _id: key, _source: { embedding: stored[key], embeddingModel: "stored-model" } }] : [] } } : hits(words);
		}),
		msearch: vi.fn(async () => ({ responses: [hits(words), hits(nearest)] })),
	};
	const embedder = { fingerprint, embed: vi.fn(async (_texts: readonly string[], _signal?: AbortSignal) => [[1, 0]]) };
	return { client, embedder, engine: elasticsearchEngine({ alias: "library", client: client as never }, embedder) };
}

describe("a search by words and meaning in Elasticsearch", () => {
	const asked = { text: "radio lessons", fields: ["title"], filters: [{ field: "itemType", equals: "book" }], size: 3, returned: { only: ["key"] }, semantic: { ratio: 0.5 } };

	it("mixes the words order with the records nearest the text's vector, with the same filters", async () => {
		const { client, engine } = mixed(["a", "b"], ["b", "c"]);
		const answer = await engine.search<{ key: string }>(asked);
		// b: 0.5/62 + 0.5/61, a: 0.5/61, c: 0.5/62.
		expect(answer.hits.map((hit) => hit.key)).toEqual(["b", "a", "c"]);
		const [{ searches }] = client.msearch.mock.calls[0] as unknown as [{ searches: Array<Record<string, unknown>> }];
		// Only vectors the same embedder made compare: while a library rebuilds after changing it, the old ones remain.
		expect(searches[3]).toMatchObject({ knn: { field: "embedding", query_vector: [1, 0], k: 50, filter: [{ term: { itemType: "book" } }, { term: { embeddingModel: "model" } }] } });
	});

	it("ranks by words alone when the embedder fails, and leaves it alone for the next searches", async () => {
		const { client, embedder, engine } = mixed(["a", "b"], ["c"], {}, "failing-model");
		embedder.embed.mockRejectedValueOnce(new Error("503 busy"));
		const answer = await engine.search<{ key: string }>(asked);
		expect(answer.hits.map((hit) => hit.key)).toEqual(["a", "b"]);
		await engine.search(asked);
		expect(embedder.embed).toHaveBeenCalledTimes(1);
		expect(client.msearch).not.toHaveBeenCalled();
	});

	it("ranks by words alone when the embedder doesn't answer within 3 seconds", async () => {
		const { client, embedder, engine } = mixed(["a"], ["c"], {}, "slow-model");
		embedder.embed.mockImplementationOnce(
			(_texts, signal) => new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason as Error))),
		);
		const answer = await engine.search<{ key: string }>(asked);
		expect(answer.hits.map((hit) => hit.key)).toEqual(["a"]);
		expect(client.msearch).not.toHaveBeenCalled();
	});

	it("ranks by words alone past the first page's start, as with a cursor", async () => {
		const { client, embedder, engine } = mixed(["a"], ["c"], {}, "cursor-model");
		await engine.search({ ...asked, after: [1, "a"] });
		expect(embedder.embed).not.toHaveBeenCalled();
		expect(client.msearch).not.toHaveBeenCalled();
	});

	it("searches near a record's stored vector without calling the embedder", async () => {
		const { client, embedder, engine } = mixed(["a"], ["c"], { K: [0, 1] });
		await engine.search({ ...asked, semantic: { ratio: 0.7, like: "K" } });
		expect(embedder.embed).not.toHaveBeenCalled();
		const [{ searches }] = client.msearch.mock.calls[0] as unknown as [{ searches: Array<Record<string, unknown>> }];
		expect(searches[3]).toMatchObject({ knn: { query_vector: [0, 1], filter: [{ term: { itemType: "book" } }, { term: { embeddingModel: "stored-model" } }] } });
	});

	it("says so when the record has no vector yet", async () => {
		const { engine } = mixed(["a"], ["c"]);
		await expect(engine.search({ ...asked, semantic: { ratio: 0.7, like: "K" } })).rejects.toThrow(SearchMeaningUnavailableError);
	});
});
