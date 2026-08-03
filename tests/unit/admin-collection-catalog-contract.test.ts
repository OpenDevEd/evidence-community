import { describe, expect, it } from "vitest";

import {
	decodeAdminCollectionChildrenCursor,
	encodeAdminCollectionChildrenCursor,
	parseAdminCollectionChildrenRequest,
	parseAdminCollectionSearchRequest,
	parseAdminCollectionView,
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
			editableOnly: false,
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

	it("rejects deleted browsing outside the native source", () => {
		expect(() =>
			parseAdminCollectionSearchRequest({
				query: "",
				sourceConnectionKey: "zotero-main",
				state: "deleted",
			}),
		).toThrow();
	});

	it("rejects malformed booleans and empty active searches", () => {
		expect(() =>
			parseAdminCollectionSearchRequest({
				editableOnly: "garbage",
				query: "teacher",
			}),
		).toThrow();
		expect(() =>
			parseAdminCollectionSearchRequest({
				query: "",
				state: "active",
			}),
		).toThrow();
	});

	it("round trips opaque child cursors", () => {
		const cursor = {
			key: "ABCD1234",
			name: "research",
			parentCollection: null,
			sortOrder: 1024,
			sourceConnectionKey: "native",
		};
		expect(decodeAdminCollectionChildrenCursor(encodeAdminCollectionChildrenCursor(cursor))).toEqual(cursor);
	});

	it("rejects unknown catalogue views", () => {
		expect(() => parseAdminCollectionView("everything")).toThrow();
	});
});
