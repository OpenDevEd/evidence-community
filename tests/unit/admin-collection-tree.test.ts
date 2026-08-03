import { describe, expect, it } from "vitest";

import type { AdminCollection } from "@/lib/admin/types";
import {
	addCollectionToSavedExpansion,
	collectionAncestorKeys,
	collectionDescendantKeys,
	collectionMovePositionOptions,
	collectionSubtreeKeys,
	compareAdminCollectionOrder,
	currentCollectionMovePosition,
	isNativeCollectionDropDestination,
	legalNativeCollectionParents,
	mergeAdminCollectionUpdates,
	resolveBeforeCollection,
	resolveNativeCollectionDrop,
} from "@/lib/admin/collection-tree";

const collection = (
	key: string,
	options: Partial<AdminCollection> = {},
): AdminCollection => ({
	deleted: false,
	key,
	name: key,
	parentCollection: null,
	revision: 1,
	sortOrder: 1024,
	sourceConnectionKey: "native",
	updatedAt: "2026-07-30T00:00:00.000Z",
	...options,
});

const collections = [
	collection("ABCD2345", { name: "Root" }),
	collection("BCDE3456", {
		name: "Child",
		parentCollection: "ABCD2345",
	}),
	collection("CDEF4567", {
		name: "Grandchild",
		parentCollection: "BCDE3456",
	}),
	collection("DEFG5678", { name: "Sibling", sortOrder: 2048 }),
	collection("EFGH6789", { deleted: true, name: "Deleted" }),
	collection("FGHJ789A", {
		name: "Imported",
		sourceConnectionKey: "zotero-main",
	}),
];

describe("admin collection tree helpers", () => {
	it("adds a newly populated parent to an explicit saved expansion state", () => {
		expect(addCollectionToSavedExpansion("", ["ABCD2345"])).toBeNull();
		expect(
			addCollectionToSavedExpansion("[]", ["ABCD2345", "BCDE3456"]),
		).toBe('["ABCD2345","BCDE3456"]');
		expect(
			addCollectionToSavedExpansion('["DEFG5678"]', [
				"ABCD2345",
				"BCDE3456",
			]),
		).toBe('["DEFG5678","ABCD2345","BCDE3456"]');
		expect(collectionAncestorKeys(collections, "CDEF4567")).toEqual([
			"ABCD2345",
			"BCDE3456",
		]);
		expect(
			collectionAncestorKeys(
				[
					{
						key: "ABCD2345",
						parentCollection: "BCDE3456",
					},
					{
						key: "BCDE3456",
						parentCollection: "ABCD2345",
					},
				],
				"ABCD2345",
			),
		).toEqual(["BCDE3456"]);
	});

	it("finds descendants and legal native parents without duplicating server rules", () => {
		expect(
			[...collectionDescendantKeys(collections, "ABCD2345")].sort(),
		).toEqual(["BCDE3456", "CDEF4567"]);
		expect(
			[...collectionSubtreeKeys(collections, "ABCD2345")].sort(),
		).toEqual(["ABCD2345", "BCDE3456", "CDEF4567"]);
		expect(
			legalNativeCollectionParents(collections, "ABCD2345").map(
				({ key }) => key,
			),
		).toEqual(["DEFG5678"]);
	});

	it("accepts only complete collection drop destinations", () => {
		expect(
			isNativeCollectionDropDestination({
				position: "inside",
				targetCollection: "ABCD2345",
			}),
		).toBe(true);
		expect(
			isNativeCollectionDropDestination({
				position: "root",
				targetCollection: null,
			}),
		).toBe(true);
		expect(
			isNativeCollectionDropDestination({
				position: "root",
				targetCollection: "ABCD2345",
			}),
		).toBe(false);
		expect(
			isNativeCollectionDropDestination({
				position: "after",
				targetCollection: null,
			}),
		).toBe(false);
		expect(isNativeCollectionDropDestination(null)).toBe(false);
	});

	it("builds human-readable sibling positions and resolves the API anchor", () => {
		const options = collectionMovePositionOptions(
			collections,
			null,
			"DEFG5678",
		);
		expect(options).toEqual([
			{ key: "first", label: "At the start" },
			{ key: "after:ABCD2345", label: "After Root" },
		]);
		expect(
			resolveBeforeCollection(collections, null, "DEFG5678", "first"),
		).toBe("ABCD2345");
		expect(
			resolveBeforeCollection(
				collections,
				null,
				"DEFG5678",
				"after:ABCD2345",
			),
		).toBeNull();
	});

	it("matches the server collection ordering after local mutation merges", () => {
		const ordered = [
			collection("DEFG5678", { name: "Zulu", sortOrder: null }),
			collection("CDEF4567", { name: "Beta", sortOrder: 2048 }),
			collection("BCDE3456", { name: "Alpha", sortOrder: 2048 }),
			collection("ABCD2345", { name: "Root", sortOrder: 1024 }),
			collection("FGHJ789A", {
				name: "Imported",
				sortOrder: 1,
				sourceConnectionKey: "zotero-main",
			}),
		].sort(compareAdminCollectionOrder);
		expect(ordered.map(({ key }) => key)).toEqual([
			"ABCD2345",
			"BCDE3456",
			"CDEF4567",
			"DEFG5678",
			"FGHJ789A",
		]);
		expect(compareAdminCollectionOrder(ordered[0]!, ordered[0]!)).toBe(0);
		expect(
			compareAdminCollectionOrder(
				collection("ABCD2345", { name: "Same", sortOrder: 1024 }),
				collection("BCDE3456", { name: "Same", sortOrder: 1024 }),
			),
		).toBeLessThan(0);
	});

	it("merges new revisions, reorders native rows, and preserves imported order", () => {
		const current = [
			collection("ABCD2345", { name: "Native first", sortOrder: 1024 }),
			collection("BCDE3456", { name: "Native second", sortOrder: 2048 }),
			collection("CDEF4567", {
				name: "Zambia",
				sortOrder: null,
				sourceConnectionKey: "zotero-main",
			}),
			collection("DEFG5678", {
				name: "",
				sortOrder: null,
				sourceConnectionKey: "zotero-main",
			}),
		];
		const merged = mergeAdminCollectionUpdates(current, [
			collection("BCDE3456", {
				name: "Native second",
				revision: 2,
				sortOrder: 512,
			}),
			collection("EFGH6789", {
				name: "New native",
				sortOrder: 3072,
			}),
		]);
		expect(merged.map(({ key }) => key)).toEqual([
			"BCDE3456",
			"ABCD2345",
			"EFGH6789",
			"CDEF4567",
			"DEFG5678",
		]);
		expect(merged[0]!.revision).toBe(2);
	});

	it("identifies the current first and after-sibling positions", () => {
		expect(
			currentCollectionMovePosition(collections, collections[0]!),
		).toBe("first");
		expect(
			currentCollectionMovePosition(collections, collections[3]!),
		).toBe("after:ABCD2345");
	});

	it("resolves native drops across siblings, parents, and the root", () => {
		expect(
			resolveNativeCollectionDrop(collections, "DEFG5678", {
				position: "before",
				targetCollection: "ABCD2345",
			}),
		).toEqual({
			beforeCollection: "ABCD2345",
			parentCollection: null,
		});
		expect(
			resolveNativeCollectionDrop(collections, "ABCD2345", {
				position: "after",
				targetCollection: "DEFG5678",
			}),
		).toEqual({
			beforeCollection: null,
			parentCollection: null,
		});
		expect(
			resolveNativeCollectionDrop(collections, "DEFG5678", {
				position: "inside",
				targetCollection: "BCDE3456",
			}),
		).toEqual({
			beforeCollection: null,
			parentCollection: "BCDE3456",
		});
		expect(
			resolveNativeCollectionDrop(collections, "CDEF4567", {
				position: "root",
				targetCollection: null,
			}),
		).toEqual({
			beforeCollection: null,
			parentCollection: null,
		});
	});

	it("ignores no-op and invalid native collection drops", () => {
		expect(
			resolveNativeCollectionDrop(collections, "ABCD2345", {
				position: "before",
				targetCollection: "DEFG5678",
			}),
		).toBeNull();
		expect(
			resolveNativeCollectionDrop(collections, "DEFG5678", {
				position: "root",
				targetCollection: null,
			}),
		).toBeNull();
		expect(
			resolveNativeCollectionDrop(collections, "ABCD2345", {
				position: "inside",
				targetCollection: "CDEF4567",
			}),
		).toBeNull();
		expect(
			resolveNativeCollectionDrop(collections, "ABCD2345", {
				position: "inside",
				targetCollection: "ABCD2345",
			}),
		).toBeNull();
		expect(
			resolveNativeCollectionDrop(collections, "ABCD2345", {
				position: "inside",
				targetCollection: "FGHJ789A",
			}),
		).toBeNull();
		expect(
			resolveNativeCollectionDrop(collections, "FGHJ789A", {
				position: "root",
				targetCollection: null,
			}),
		).toBeNull();
	});
});
