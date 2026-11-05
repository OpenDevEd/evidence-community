import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { pagePosition } from "@/lib/search";
import { decodeCursor, encodeCursor, fieldNotIn, searchOrder, yearRange } from "@/lib/search-engine";

const newest = searchOrder("elasticsearch", { text: "", sort: ["year:desc"] });
const relevance = searchOrder("elasticsearch", { text: "tutoring" });

describe("a cursor", () => {
	it("gives back the place it was made from, in the order it was made in", () => {
		expect(decodeCursor(encodeCursor(newest, [2024, "ABCD1234"]), newest)).toEqual([2024, "ABCD1234"]);
		expect(decodeCursor(encodeCursor(relevance, [3.5, "ABCD1234"]), relevance)).toEqual([3.5, "ABCD1234"]);
		const offsets = searchOrder("meilisearch", { text: "tutoring" });
		expect(decodeCursor(encodeCursor(offsets, [10_019]), offsets)).toEqual([10_019]);
	});

	it("places nothing in another order, another engine, or when it is not a cursor", () => {
		const cursor = encodeCursor(newest, [2024, "ABCD1234"]);
		expect(decodeCursor(cursor, searchOrder("elasticsearch", { text: "", sort: ["year:asc"] }))).toBeNull();
		// The same order with search text ranks by relevance first.
		expect(decodeCursor(cursor, searchOrder("elasticsearch", { text: "tutoring", sort: ["year:desc"] }))).toBeNull();
		expect(decodeCursor(cursor, searchOrder("meilisearch", { text: "", sort: ["year:desc"] }))).toBeNull();
		expect(decodeCursor("not-a-cursor", newest)).toBeNull();
		expect(decodeCursor(encodeCursor(newest, [2024]), newest)).toBeNull();
		expect(decodeCursor(encodeCursor(newest, [{} as never, "A"]), newest)).toBeNull();
		expect(encodeCursor(newest, null)).toBeNull();
	});

	it("places nothing at a value Elasticsearch can't sort that field by", () => {
		expect(decodeCursor(encodeCursor(relevance, ["x", "ABCD1234"]), relevance)).toBeNull();
		expect(decodeCursor(encodeCursor(newest, ["2024", "ABCD1234"]), newest)).toBeNull();
		expect(decodeCursor(encodeCursor(newest, [2024, 7]), newest)).toBeNull();
		// A record without a date sorts at infinity, which Elasticsearch writes as a string.
		expect(decodeCursor(encodeCursor(newest, ["-Infinity", "ABCD1234"]), newest)).toEqual(["-Infinity", "ABCD1234"]);
		const byAuthor = searchOrder("elasticsearch", { text: "", sort: ["fullNames:asc"] });
		expect(decodeCursor(encodeCursor(byAuthor, [null, "ABCD1234"]), byAuthor)).toEqual([null, "ABCD1234"]);
	});

	it("places nothing at an offset Meilisearch can't page to", () => {
		const offsets = searchOrder("meilisearch", { text: "tutoring" });
		for (const at of [-5, 1.5, "20", null]) expect(decodeCursor(encodeCursor(offsets, [at]), offsets)).toBeNull();
	});
});

describe("where a page starts", () => {
	const next = encodeCursor(relevance, [1.25, "NEXTKEY1"])!;

	it("is an offset on the numbered pages, and ignores a cursor there", () => {
		expect(pagePosition(3, 20, {}, relevance)).toEqual({ page: 3, start: { from: 40 } });
		expect(pagePosition(500, 20, { after: next }, relevance)).toEqual({ page: 500, start: { from: 9_980 } });
	});

	it("is after or before the cursor's record past them", () => {
		expect(pagePosition(501, 20, { after: next }, relevance)).toEqual({ page: 501, start: { after: [1.25, "NEXTKEY1"] } });
		expect(pagePosition(501, 20, { before: next }, relevance)).toEqual({ page: 501, start: { before: [1.25, "NEXTKEY1"] } });
	});

	it("is an offset on any page of a library searching Meilisearch, which pages that far by itself", () => {
		const offsets = searchOrder("meilisearch", { text: "tutoring" });
		expect(pagePosition(600, 20, {}, offsets)).toEqual({ page: 600, start: { from: 11_980 } });
	});

	it("is the first page when the cursor belongs to another order", () => {
		expect(pagePosition(501, 20, { after: next }, newest)).toEqual({ page: 1, start: { from: 0 } });
	});
});

describe("a year range", () => {
	it("reads one year, a span, or an open end", () => {
		expect(yearRange("2015")).toEqual({ field: "year", equals: 2015 });
		expect(yearRange("2015-2020")).toEqual({ field: "year", range: { gte: 2015, lte: 2020 } });
		expect(yearRange("2015-")).toEqual({ field: "year", range: { gte: 2015 } });
		expect(yearRange("-2020")).toEqual({ field: "year", range: { lte: 2020 } });
	});

	it("is no filter when it names no year", () => {
		expect(yearRange(null)).toBeNull();
		expect(yearRange("recent")).toBeNull();
		expect(yearRange("-")).toBeNull();
	});
});

it("leaves values out with a negated filter", () => {
	expect(fieldNotIn("itemType", ["Note"])).toEqual({ not: { field: "itemType", in: ["Note"] } });
});
