import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { pagePosition } from "@/lib/search";
import {
	decodeCursor,
	encodeCursor,
	facetAggregations,
	facetDistribution,
	sortClauses,
	textQuery,
	yearRange,
} from "@/lib/search-engine";

const newest = sortClauses(["year:desc"]);
const relevance = sortClauses(undefined, { text: "tutoring" });

describe("a cursor", () => {
	it("gives back the place it was made from, in the order it was made in", () => {
		expect(decodeCursor(encodeCursor(newest, [2024, "ABCD1234"]), newest)).toEqual([2024, "ABCD1234"]);
		expect(decodeCursor(encodeCursor(relevance, [3.5, "ABCD1234"]), relevance)).toEqual([3.5, "ABCD1234"]);
	});

	it("places nothing in another order, or when it is not a cursor", () => {
		const cursor = encodeCursor(newest, [2024, "ABCD1234"]);
		expect(decodeCursor(cursor, sortClauses(["year:asc"]))).toBeNull();
		// The same order with search text ranks by relevance first.
		expect(decodeCursor(cursor, sortClauses(["year:desc"], { text: "tutoring" }))).toBeNull();
		expect(decodeCursor("not-a-cursor", newest)).toBeNull();
		expect(decodeCursor(encodeCursor(newest, [2024]), newest)).toBeNull();
		expect(decodeCursor(encodeCursor(newest, [{} as never, "A"]), newest)).toBeNull();
		expect(encodeCursor(newest, undefined)).toBeNull();
	});
});

describe("where a page starts", () => {
	const next = encodeCursor(relevance, [1.25, "NEXTKEY1"])!;

	it("is an offset on the numbered pages, and ignores a cursor there", () => {
		expect(pagePosition(3, 20, {}, relevance)).toEqual({ page: 3, from: 40, searchAfter: null, reverse: false });
		expect(pagePosition(500, 20, { after: next }, relevance)).toEqual({ page: 500, from: 9_980, searchAfter: null, reverse: false });
	});

	it("is after the cursor's record past them, or before it read backwards", () => {
		expect(pagePosition(501, 20, { after: next }, relevance)).toEqual({ page: 501, from: null, searchAfter: [1.25, "NEXTKEY1"], reverse: false });
		expect(pagePosition(501, 20, { before: next }, relevance)).toEqual({ page: 501, from: null, searchAfter: [1.25, "NEXTKEY1"], reverse: true });
	});

	it("is the first page when the cursor belongs to another order", () => {
		expect(pagePosition(501, 20, { after: next }, newest)).toEqual({ page: 1, from: 0, searchAfter: null, reverse: false });
	});
});

describe("the order of results", () => {
	it("ranks a search by relevance, and always ends on the record key so ties keep one order", () => {
		expect(relevance).toEqual([{ _score: { order: "desc" } }, { key: { order: "asc" } }]);
		expect(sortClauses(["title:asc"])).toEqual([{ "title.sort": { order: "asc", missing: "_last" } }, { key: { order: "asc" } }]);
	});

	it("sorts a search's ties by the chosen order, as Meilisearch put its sort after relevance", () => {
		expect(sortClauses(["citationCount:desc"], { text: "knowledge tracing" })).toEqual([
			{ _score: { order: "desc" } },
			{ citationCount: { order: "desc", missing: "_last" } },
			{ key: { order: "asc" } },
		]);
	});

	it("lists records by key when nothing is searched or sorted", () => {
		expect(sortClauses(undefined)).toEqual([{ key: { order: "asc" } }]);
		expect(sortClauses(undefined, { text: "  " })).toEqual([{ key: { order: "asc" } }]);
	});

	it("reads backwards with every direction flipped", () => {
		expect(sortClauses(["year:desc"], { reverse: true })).toEqual([{ year: { order: "asc", missing: "_first" } }, { key: { order: "desc" } }]);
		expect(sortClauses(undefined, { text: "tutoring", reverse: true })).toEqual([{ _score: { order: "asc" } }, { key: { order: "desc" } }]);
	});
});

describe("a year range", () => {
	it("reads one year, a span, or an open end", () => {
		expect(yearRange("2015")).toEqual({ term: { year: 2015 } });
		expect(yearRange("2015-2020")).toEqual({ range: { year: { gte: 2015, lte: 2020 } } });
		expect(yearRange("2015-")).toEqual({ range: { year: { gte: 2015 } } });
		expect(yearRange("-2020")).toEqual({ range: { year: { lte: 2020 } } });
	});

	it("is no filter when it names no year", () => {
		expect(yearRange(null)).toBeNull();
		expect(yearRange("recent")).toBeNull();
		expect(yearRange("-")).toBeNull();
	});
});

describe("the text of a search", () => {
	const clauses = (text: string, attributes = ["title", "abstractNote", "tags", "fullNames"]) => JSON.stringify(textQuery(text, attributes));

	it("is no query when there are no words", () => {
		expect(textQuery("  ", ["title"])).toBeNull();
	});

	it("needs only the first word, with Meilisearch's typos, and ranks records with the other words higher", () => {
		const query = textQuery("knowledge tracing", ["title"]) as { bool: { filter: unknown[]; should: unknown[] } };
		expect(JSON.stringify(query.bool.filter)).toContain('"query":"knowledge"');
		expect(JSON.stringify(query.bool.filter)).not.toContain("tracing");
		expect(clauses("knowledge tracing")).toContain('"fuzziness":"AUTO:5,9"');
		expect(JSON.stringify(query.bool.should)).toContain('"query":"tracing"');
	});

	it("takes the last word as the start of a longer one", () => {
		expect(clauses("generat")).toContain('"type":"phrase_prefix"');
	});

	it("searches whole-value fields by their words, and an earlier field ranks higher", () => {
		const query = clauses("tutoring");
		expect(query).toContain('"tags.text"');
		expect(query).toContain('"fullNames.text"');
		expect(query).toMatch(/"title":\{"query":"tutoring","operator":"and"\}\}\},"boost":90/u);
		expect(query).toMatch(/"fullNames\.text":\{"query":"tutoring","operator":"and"\}\}\},"boost":60/u);
	});

	it("searches the first ten words, as Meilisearch did", () => {
		expect(clauses("one two three four five six seven eight nine ten eleven")).not.toContain("eleven");
	});

	it("ranks titles that start with the words, then the exact title, only without a chosen order", () => {
		expect(clauses("tutor copilot")).toContain('"title.start"');
		const sorted = JSON.stringify(textQuery("tutor copilot", ["title"], { sorted: true }));
		expect(sorted).not.toContain("title.start");
		expect(sorted).not.toContain("title.sort");
	});

	it("finds the start of a title with typos, and a long enough last word as the start of a longer one", () => {
		expect(clauses("machne")).toContain('"fuzzy":{"term":"machne"');
		expect(clauses("generat")).toContain('"prefix":{"prefix":"generat"}');
		// A short prefix can name more words than Elasticsearch expands, which would fail the search.
		expect(clauses("ab")).not.toContain('"prefix":{"prefix"');
		// A word the index holds as several terms is matched as a phrase.
		expect(clauses("self-regulated")).toContain('"match":{"query":"self-regulated"');
		expect(clauses("教育")).toContain('"match":{"query":"教育"');
	});

	it("ranks a record whose title is the search first only when titles are searched", () => {
		expect(clauses("Tutor CoPilot", ["title"])).toContain('"title.sort":{"value":"Tutor CoPilot"');
		expect(clauses("Tutor CoPilot", ["abstractNote"])).not.toContain("title.sort");
	});
});

describe("facet counts", () => {
	it("lists counted facets by count and the rest by value", () => {
		expect(facetAggregations(["country", "year"])).toEqual({
			country: { terms: { field: "country", size: 10_000, order: { _count: "desc" } } },
			year: { terms: { field: "year", size: 10_000, order: { _key: "asc" } } },
		});
	});

	it("reads each value's count, naming true and false as words", () => {
		expect(
			facetDistribution({
				country: { buckets: [{ key: "KE", doc_count: 4 }, { key: "QA", doc_count: 1 }] },
				hasPdf: { buckets: [{ key: 1, key_as_string: "true", doc_count: 2 }] },
			}),
		).toEqual({ country: { KE: 4, QA: 1 }, hasPdf: { true: 2 } });
		expect(facetDistribution(undefined)).toEqual({});
	});
});
