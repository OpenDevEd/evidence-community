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

	it("parses false boolean query parameters as false", () => {
		expect(
			parseAdminCollectionSearchRequest({
				editableOnly: "false",
				includeDeleted: "false",
				query: "teacher",
			}),
		).toMatchObject({ editableOnly: false, includeDeleted: false });
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
