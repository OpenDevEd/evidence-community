import { describe, expect, it } from "vitest";

import {
	decodeAdminCollectionChildrenCursor,
	encodeAdminCollectionChildrenCursor,
	parseAdminCollectionChildrenRequest,
	parseAdminCollectionSearchRequest,
	parseAdminCollectionView,
	parseOpenScholarCollectionRequest,
} from "@/lib/admin/collection-catalog-contract";

describe("admin collection catalogue contract", () => {
	it("parses paginated child browsing without changing the root parent", () => {
		expect(
			parseAdminCollectionChildrenRequest({
				pageSize: "75",
				parentCollection: null,
				sourceConnectionKey: "native",
			}),
		).toMatchObject({
			cursor: null,
			pageSize: 75,
			parentCollection: null,
			sourceConnectionKey: "native",
		});
	});

	it("defaults catalogue searches to active collections", () => {
		expect(
			parseAdminCollectionSearchRequest({
				query: "teacher",
			}),
		).toMatchObject({
			state: "active",
		});
	});

	it("parses an explicit deleted-only catalogue search", () => {
		expect(
			parseAdminCollectionSearchRequest({
				query: "archive",
				sourceConnectionKey: "native",
				state: "deleted",
			}),
		).toMatchObject({
			query: "archive",
			sourceConnectionKey: "native",
			state: "deleted",
		});
	});

	it("allows deleted browsing within a writeback source", () => {
		expect(
			parseAdminCollectionSearchRequest({
				query: "",
				sourceConnectionKey: "zotero-main",
				state: "deleted",
			}),
		).toMatchObject({
			query: "",
			sourceConnectionKey: "zotero-main",
			state: "deleted",
		});
	});

	it("rejects empty active searches", () => {
		expect(() =>
			parseAdminCollectionSearchRequest({
				query: "",
				state: "active",
			}),
		).toThrow();
	});

	it("round trips opaque child cursors", () => {
		const cursor = {
			key: "ABCD2345",
			name: "research",
			parentCollection: null,
			sortOrder: 1024,
			sourceConnectionKey: "native",
		};
		expect(
			decodeAdminCollectionChildrenCursor(
				encodeAdminCollectionChildrenCursor(cursor),
			),
		).toEqual(cursor);
	});

	it("rejects unknown catalogue views", () => {
		expect(() => parseAdminCollectionView("everything")).toThrow();
	});
});

describe("OpenScholar collection request", () => {
	it("lists the whole catalogue when no search text is given", () => {
		expect(parseOpenScholarCollectionRequest({})).toEqual({
			cursor: null,
			ids: null,
			pageSize: 50,
			query: "",
		});
	});

	it("keeps search text, cursor, and a bounded page size", () => {
		expect(
			parseOpenScholarCollectionRequest({
				cursor: "abc",
				pageSize: "100",
				query: "  teacher ",
			}),
		).toEqual({ cursor: "abc", ids: null, pageSize: 100, query: "teacher" });
		expect(() =>
			parseOpenScholarCollectionRequest({ pageSize: "101" }),
		).toThrow();
	});

	it("reads a list of ids and drops repeats", () => {
		expect(
			parseOpenScholarCollectionRequest({
				ids: " ABCD2345 , EFGH6789 ,ABCD2345",
			}).ids,
		).toEqual(["ABCD2345", "EFGH6789"]);
	});

	it("refuses more ids than a picker may ask for at once", () => {
		const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
		const ids = Array.from(
			{ length: 201 },
			(_unused, index) =>
				`KEYCAP${alphabet[Math.floor(index / alphabet.length)]}${
					alphabet[index % alphabet.length]
				}`,
		);
		// Every id on its own is a real key, so the cap is the only reason to
		// refuse this list.
		expect(parseOpenScholarCollectionRequest({ ids: ids[200] }).ids).toEqual([
			ids[200],
		]);
		expect(() =>
			parseOpenScholarCollectionRequest({ ids: ids.join(",") }),
		).toThrow();
	});

	it("refuses an id that is not a collection key", () => {
		expect(() =>
			parseOpenScholarCollectionRequest({ ids: "too-short" }),
		).toThrow();
		// Eight characters is not enough: 0, 1 and O are not record keys.
		expect(() =>
			parseOpenScholarCollectionRequest({ ids: "ABCD0123" }),
		).toThrow();
	});

	it("refuses ids asked for together with a search or a page", () => {
		expect(() =>
			parseOpenScholarCollectionRequest({
				ids: "ABCD2345",
				query: "teacher",
			}),
		).toThrow();
		expect(() =>
			parseOpenScholarCollectionRequest({
				cursor: "abc",
				ids: "ABCD2345",
			}),
		).toThrow();
	});
});
