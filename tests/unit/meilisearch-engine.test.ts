import { describe, expect, it, vi } from "vitest";

import type { MeilisearchService } from "@/lib/meilisearch-factory";
import { fieldEquals, fieldIn, fieldNotIn, fieldPresent, SearchChangedError, yearRange } from "@/lib/search-engine";
import { filterExpression, meilisearchEngine } from "@/lib/search-engines/meilisearch";

describe("a filter in Meilisearch", () => {
	it("becomes the filter expression the library searched with before", () => {
		expect(filterExpression(fieldEquals("fullNames", 'Ada "A." Lovelace'))).toBe('fullNames = "Ada \\"A.\\" Lovelace"');
		expect(filterExpression(fieldEquals("deleted", 0))).toBe("deleted = 0");
		expect(filterExpression(fieldIn("country", ["KE", "QA"]))).toBe('country IN ["KE","QA"]');
		expect(filterExpression(fieldNotIn("itemType", ["Note"]))).toBe('NOT (itemType IN ["Note"])');
		expect(filterExpression(fieldPresent("fullTextPDFs.fullTextPDF.page"))).toBe(
			"(fullTextPDFs.fullTextPDF.page EXISTS AND fullTextPDFs.fullTextPDF.page IS NOT EMPTY AND fullTextPDFs.fullTextPDF.page IS NOT NULL)",
		);
		// A record made in the library has `sources: []`, which belongs to no source.
		expect(filterExpression(fieldPresent("sources"))).toBe("(sources EXISTS AND sources IS NOT EMPTY AND sources IS NOT NULL)");
		expect(filterExpression(yearRange("2015-2020")!)).toBe("(year >= 2015 AND year <= 2020)");
		expect(filterExpression({ any: [fieldEquals("a", "x"), fieldEquals("b", "y")] })).toBe('(a = "x" OR b = "y")');
	});

	it("refuses a field name that could change the expression", () => {
		expect(() => filterExpression(fieldEquals("year OR 1", 1))).toThrow("Invalid Meilisearch filter field");
	});
});

function fakeIndex(hits: Array<Record<string, unknown>>, total = 40, estimated = total) {
	return {
		search: vi.fn(async (_text: string, params: { limit?: number; hitsPerPage?: number }) =>
			params.hitsPerPage === 0
				? { hits: [], totalHits: total }
				: { hits: hits.slice(0, params.limit), estimatedTotalHits: estimated, facetDistribution: { year: { "2024": 3 } } }),
		getDisplayedAttributes: vi.fn(async () => ["*"]),
		getStats: vi.fn(async () => ({ fieldDistribution: { key: 1, title: 1, fullTextPDFs: 1, "fullTextPDFs.fullTextPDF.text": 1, topics: 1 } })),
		getDocument: vi.fn(),
	};
}

function engineWith(index: ReturnType<typeof fakeIndex>) {
	return meilisearchEngine({ client: {} as never, index: index as never, indexName: "library" } as MeilisearchService);
}

describe("a search in Meilisearch", () => {
	const request = { text: "tutoring", fields: ["title", "abstractNote"], filters: [fieldEquals("deleted", 0)], size: 2 };

	it("sends the words, fields, order, filters and facets, and places each page by offset", async () => {
		const index = fakeIndex([{ key: "A" }, { key: "B" }]);
		const answer = await engineWith(index).search({ ...request, sort: ["year:desc"], from: 20, facets: ["year"], returned: { only: ["key"] } });
		expect(index.search).toHaveBeenCalledWith("tutoring", {
			offset: 20,
			limit: 2,
			filter: ["deleted = 0"],
			attributesToSearchOn: ["title", "abstractNote"],
			sort: ["year:desc"],
			facets: ["year"],
			attributesToRetrieve: ["key"],
		}, { signal: undefined });
		expect(answer).toEqual({ hits: [{ key: "A" }, { key: "B" }], total: 40, facets: { year: { "2024": 3 } }, first: [20], last: [21] });
	});

	it("continues after or before a place", async () => {
		const index = fakeIndex([{ key: "A" }]);
		const engine = engineWith(index);
		await engine.search({ ...request, after: [21] });
		expect(index.search).toHaveBeenLastCalledWith("tutoring", expect.objectContaining({ offset: 22 }), { signal: undefined });
		await engine.search({ ...request, before: [20] });
		expect(index.search).toHaveBeenLastCalledWith("tutoring", expect.objectContaining({ offset: 18 }), { signal: undefined });
	});

	it("starts the last page from the exact count, and answers that count", async () => {
		const index = fakeIndex([{ key: "A" }], 39, 41);
		const answer = await engineWith(index).search({ ...request, fromEnd: true });
		expect(index.search).toHaveBeenLastCalledWith("tutoring", expect.objectContaining({ offset: 37 }), { signal: undefined });
		expect(answer.total).toBe(39);
	});

	it("ranks by meaning with the library's embedder, and by words alone while the embedder is being set up", async () => {
		const { MeilisearchApiError } = await import("meilisearch");
		const index = fakeIndex([{ key: "A" }]);
		index.search.mockRejectedValueOnce(
			new MeilisearchApiError(new Response(null, { status: 400 }), {
				code: "invalid_search_embedder",
				link: "",
				message: "Cannot find embedder with name `default`.",
				type: "invalid_request",
			}),
		);
		const answer = await engineWith(index).search({ ...request, semantic: { ratio: 0.5 } });
		expect(index.search.mock.calls[0]![1]).toMatchObject({ hybrid: { embedder: "default", semanticRatio: 0.5 } });
		expect(index.search.mock.calls[1]![1]).not.toHaveProperty("hybrid");
		expect(answer.hits).toEqual([{ key: "A" }]);
	});

	it("names every stored field but the ones left out, since Meilisearch can't leave fields out itself", async () => {
		const index = fakeIndex([]);
		await engineWith(index).search({ ...request, returned: { except: ["fullTextPDFs", "topics"] } });
		expect(index.search).toHaveBeenLastCalledWith("tutoring", expect.objectContaining({ attributesToRetrieve: ["key", "title"] }), { signal: undefined });
	});
});

describe("a deep key walk in Meilisearch", () => {
	const request = { text: "", fields: [], filters: [], size: 0 };
	const signal = new AbortController().signal;

	/** An index of `count` records whose task log moves to `after` once the walk has read its pages. */
	function walkable(count: number, options: { maxTotalHits?: number; tasks?: number[]; keys?: string[] } = {}) {
		const keys = options.keys ?? Array.from({ length: count }, (_, position) => `KEY${String(position).padStart(5, "0")}`);
		const tasks = [...(options.tasks ?? [7, 7])];
		const index = {
			getSettings: vi.fn(async () => ({ pagination: { maxTotalHits: options.maxTotalHits ?? 10_000_000 } })),
			search: vi.fn(async (_text: string, params: { offset?: number; limit?: number; hitsPerPage?: number }) =>
				params.hitsPerPage === 0 ? { hits: [], totalHits: keys.length } : { hits: keys.slice(params.offset, (params.offset ?? 0) + (params.limit ?? 0)).map((key) => ({ key })) }),
		};
		let read = 0;
		const client = {
			tasks: {
				getTasks: vi.fn(async (filter: { statuses?: string[] }) => {
					if (filter.statuses) return { results: [] };
					read += 1;
					// Two lookups (this index, index swaps) before the walk and two after.
					return { results: [{ uid: tasks[read <= 2 ? 0 : 1] }] };
				}),
			},
		};
		return meilisearchEngine({ client: client as never, index: index as never, indexName: "library" });
	}

	it("reads every key from an offset in pages, and the total", async () => {
		expect(await walkable(1_203).keys(request, 2, 1_201, signal)).toEqual({ keys: Array.from({ length: 1_201 }, (_, position) => `KEY${String(position + 2).padStart(5, "0")}`), total: 1_203 });
	});

	it("refuses when a write finished while it read", async () => {
		await expect(walkable(10, { tasks: [7, 8] }).keys(request, 0, 10, signal)).rejects.toBeInstanceOf(SearchChangedError);
	});

	it("refuses when a record comes back twice, as one moved between pages", async () => {
		await expect(walkable(2, { keys: ["SAMEKEY1", "SAMEKEY1"] }).keys(request, 0, 2, signal)).rejects.toBeInstanceOf(SearchChangedError);
	});

	it("refuses when the index can't page as deep as asked", async () => {
		await expect(walkable(10, { maxTotalHits: 1_000 }).keys(request, 0, 20_001, signal)).rejects.toMatchObject({ notReady: true });
	});

	it("refuses when the total reaches as far as Meilisearch counts, as it may be short", async () => {
		await expect(walkable(10, { maxTotalHits: 10 }).keys(request, 0, 5, signal)).rejects.toMatchObject({ notReady: true });
	});
});
