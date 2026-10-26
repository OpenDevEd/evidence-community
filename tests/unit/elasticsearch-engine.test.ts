import { describe, expect, it, vi } from "vitest";

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
