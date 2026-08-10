import { describe, expect, it } from "vitest";

import {
	editableItemCollectionSourceKeys,
	editableItemCollectionSourceKeysForItems,
	itemCollectionSourceIsAssignable,
} from "@/lib/admin/item-collection-policy";

const sources = [
	{ key: "native", readOnly: false },
	{ key: "zotero-main", readOnly: false },
	{ key: "zotero-secondary", readOnly: false },
	{ key: "zotero-locked", readOnly: true },
];

describe("admin item collection source policy", () => {
	it("allows native and the item's own source only", () => {
		expect(itemCollectionSourceIsAssignable("zotero-main", "native")).toBe(
			true,
		);
		expect(
			itemCollectionSourceIsAssignable("zotero-main", "zotero-main"),
		).toBe(true);
		expect(
			itemCollectionSourceIsAssignable("zotero-main", "zotero-secondary"),
		).toBe(false);
	});

	it("filters unavailable collection sources", () => {
		expect(editableItemCollectionSourceKeys("zotero-main", sources)).toEqual([
			"native",
			"zotero-main",
		]);
		expect(editableItemCollectionSourceKeys("native", sources)).toEqual([
			"native",
		]);
	});

	it("uses native as the common source for mixed-source items", () => {
		expect(
			editableItemCollectionSourceKeysForItems(
				["native", "zotero-main"],
				sources,
			),
		).toEqual(["native"]);
		expect(
			editableItemCollectionSourceKeysForItems(
				["zotero-main", "zotero-main"],
				sources,
			),
		).toEqual(["native", "zotero-main"]);
	});
});
