import { describe, expect, it } from "vitest";

import {
	NativeCollectionConflictError,
	NativeCollectionValidationError,
	assertExpectedNativeCollectionRevision,
	assertValidNativeCollectionParent,
	nativeCollectionRestoreCohortKeys,
	nextNativeCollectionSortOrder,
	normalizeNativeCollectionMoveInput,
	normalizeNativeCollectionRenameInput,
	normalizeNativeCollectionInput,
	planNativeCollectionPosition,
	resolveNativeCollectionMoveIntent,
} from "@/lib/admin/native-collection-service";
import { collectionDescendantKeys } from "@/lib/admin/collection-hierarchy";

const rows = [
	{
		deleted: 0,
		key: "ABCD2345",
		parentCollection: null,
		sourceConnectionKey: "native",
	},
	{
		deleted: 0,
		key: "BCDE3456",
		parentCollection: "ABCD2345",
		sourceConnectionKey: "native",
	},
	{
		deleted: 0,
		key: "CDEF4567",
		parentCollection: "BCDE3456",
		sourceConnectionKey: "native",
	},
	{
		deleted: 1,
		key: "DEFG5678",
		parentCollection: null,
		sourceConnectionKey: "native",
	},
	{
		deleted: 0,
		key: "EFGH6789",
		parentCollection: null,
		sourceConnectionKey: "zotero-main",
	},
];

describe("native collection validation", () => {
	it("normalizes names and optional parents", () => {
		expect(
			normalizeNativeCollectionInput({ name: "  Evidence  " }),
		).toEqual({
			name: "Evidence",
			parentCollection: null,
		});
	});

	it("keeps rename and move mutation payloads independent", () => {
		expect(
			normalizeNativeCollectionRenameInput({
				expectedRevision: 3,
				name: "  Renamed  ",
			}),
		).toEqual({ expectedRevision: 3, name: "Renamed" });
		expect(
			normalizeNativeCollectionMoveInput({
				expectedRevision: 4,
				position: "after",
				targetCollection: "BCDE3456",
			}),
		).toEqual({
			expectedRevision: 4,
			position: "after",
			targetCollection: "BCDE3456",
		});
		expect(
			normalizeNativeCollectionMoveInput({
				expectedRevision: 4,
				position: "root",
			}),
		).toEqual({ expectedRevision: 4, position: "root" });
		expect(() =>
			normalizeNativeCollectionRenameInput({
				expectedRevision: 3,
				name: "Renamed",
				parentCollection: null,
			}),
		).toThrow();
	});

	it("resolves move intent against the locked sibling order", () => {
		const orderedRows = [
			{
				deleted: 0,
				key: "ABCD2345",
				name: "First",
				parentCollection: null,
				sortOrder: 1024,
				sourceConnectionKey: "native",
			},
			{
				deleted: 0,
				key: "BCDE3456",
				name: "Second",
				parentCollection: null,
				sortOrder: 2048,
				sourceConnectionKey: "native",
			},
			{
				deleted: 0,
				key: "CDEF4567",
				name: "Third",
				parentCollection: null,
				sortOrder: 3072,
				sourceConnectionKey: "native",
			},
		];
		expect(
			resolveNativeCollectionMoveIntent(orderedRows, "CDEF4567", {
				position: "after",
				targetCollection: "ABCD2345",
			}),
		).toEqual({
			beforeCollection: "BCDE3456",
			parentCollection: null,
		});
		expect(
			resolveNativeCollectionMoveIntent(orderedRows, "ABCD2345", {
				position: "inside",
				targetCollection: "BCDE3456",
			}),
		).toEqual({
			beforeCollection: null,
			parentCollection: "BCDE3456",
		});
		expect(() =>
			resolveNativeCollectionMoveIntent(orderedRows, "ABCD2345", {
				position: "after",
				targetCollection: "ABCD2345",
			}),
		).toThrow(NativeCollectionValidationError);
	});

	it("rejects stale mutation revisions with the current revision", () => {
		expect(() =>
			assertExpectedNativeCollectionRevision(
				{ key: "ABCD2345", revision: 7 },
				6,
			),
		).toThrow(NativeCollectionConflictError);
		try {
			assertExpectedNativeCollectionRevision(
				{ key: "ABCD2345", revision: 7 },
				6,
			);
		} catch (error) {
			expect(error).toMatchObject({ currentRevision: 7 });
		}
	});

	it("rejects deleted or imported parents and hierarchy cycles", () => {
		try {
			assertValidNativeCollectionParent(rows, null, "DEFG5678");
			expect.unreachable("Expected invalid parent error");
		} catch (error) {
			expect(error).toBeInstanceOf(NativeCollectionValidationError);
			expect(error).toMatchObject({
				fields: {
					parentCollection:
						"Choose an active collection created in this library.",
				},
			});
		}
		expect(() =>
			assertValidNativeCollectionParent(rows, null, "EFGH6789"),
		).toThrow(NativeCollectionValidationError);
		try {
			assertValidNativeCollectionParent(rows, "ABCD2345", "CDEF4567");
			expect.unreachable("Expected hierarchy cycle error");
		} catch (error) {
			expect(error).toMatchObject({
				fields: {
					parentCollection:
						"A collection cannot be placed inside itself or one of its subcollections.",
				},
			});
		}
	});

	it("returns every descendant for subtree soft deletion", () => {
		expect([...collectionDescendantKeys(rows, "ABCD2345")].sort()).toEqual([
			"BCDE3456",
			"CDEF4567",
		]);
	});

	it("appends native collections within their destination siblings", () => {
		expect(
			nextNativeCollectionSortOrder(
				[
					{
						parentCollection: null,
						sortOrder: 1024,
						sourceConnectionKey: "native",
					},
					{
						parentCollection: null,
						sortOrder: 4096,
						sourceConnectionKey: "zotero-group",
					},
					{
						parentCollection: "ABCD2345",
						sortOrder: 2048,
						sourceConnectionKey: "native",
					},
				],
				null,
			),
		).toBe(2048);
		expect(nextNativeCollectionSortOrder([], null)).toBe(1024);
	});

	it("uses sparse positions until a destination needs rebalancing", () => {
		expect(
			planNativeCollectionPosition(
				[
					{
						deleted: 0,
						key: "ABCD2345",
						name: "First",
						parentCollection: null,
						sortOrder: 1024,
						sourceConnectionKey: "native",
					},
					{
						deleted: 0,
						key: "BCDE3456",
						name: "Second",
						parentCollection: null,
						sortOrder: 2048,
						sourceConnectionKey: "native",
					},
				],
				"CDEF4567",
				null,
				"BCDE3456",
			),
		).toEqual([{ key: "CDEF4567", sortOrder: 1536 }]);

		expect(
			planNativeCollectionPosition(
				[
					{
						deleted: 0,
						key: "ABCD2345",
						name: "First",
						parentCollection: null,
						sortOrder: 1,
						sourceConnectionKey: "native",
					},
					{
						deleted: 0,
						key: "BCDE3456",
						name: "Second",
						parentCollection: null,
						sortOrder: 2,
						sourceConnectionKey: "native",
					},
				],
				"CDEF4567",
				null,
				"BCDE3456",
			),
		).toEqual([
			{ key: "ABCD2345", sortOrder: 1024 },
			{ key: "CDEF4567", sortOrder: 2048 },
			{ key: "BCDE3456", sortOrder: 3072 },
		]);
	});

	it("restores only descendants from the selected delete cohort", () => {
		const firstDelete = new Date("2026-07-30T10:00:00.000Z");
		const olderDelete = new Date("2026-07-29T10:00:00.000Z");
		expect(
			nativeCollectionRestoreCohortKeys(
				[
					{
						deleted: 1,
						deletedAt: firstDelete,
						key: "ABCD2345",
						parentCollection: null,
					},
					{
						deleted: 1,
						deletedAt: firstDelete,
						key: "BCDE3456",
						parentCollection: "ABCD2345",
					},
					{
						deleted: 1,
						deletedAt: olderDelete,
						key: "CDEF4567",
						parentCollection: "ABCD2345",
					},
				],
				"ABCD2345",
				firstDelete,
			),
		).toEqual(["ABCD2345", "BCDE3456"]);
	});
});
