import { describe, expect, it } from "vitest";

import { NativeItemValidationError } from "@/lib/admin/native-item-validation";
import {
	assertValidItemCollectionMemberships as assertValidNativeItemCollectionMemberships,
	itemCollectionBaselineKeys as nativeItemCollectionBaselineKeys,
} from "@/lib/admin/native-item-service";

const collectionRows = [
	{
		deleted: 0,
		key: "ABCD2345",
		sourceConnectionKey: "native",
	},
	{
		deleted: 0,
		key: "BCDE3456",
		sourceConnectionKey: "zotero-main",
	},
	{
		deleted: 0,
		key: "CDEF4567",
		sourceConnectionKey: "zotero-secondary",
	},
	{
		deleted: 1,
		key: "DEFG5678",
		sourceConnectionKey: "native",
	},
	{
		deleted: 1,
		key: "EFGH6789",
		sourceConnectionKey: "zotero-main",
	},
];

describe("native item collection memberships", () => {
	it("allows a linked item to change native and same-source memberships", () => {
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: [],
				collectionRows,
				itemSourceConnectionKey: "zotero-main",
				desiredCollectionKeys: ["ABCD2345", "BCDE3456"],
			}),
		).not.toThrow();
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: ["ABCD2345", "BCDE3456"],
				collectionRows,
				itemSourceConnectionKey: "zotero-main",
				desiredCollectionKeys: [],
			}),
		).not.toThrow();
	});

	it("keeps collections from another source immutable", () => {
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: [],
				collectionRows,
				itemSourceConnectionKey: "zotero-main",
				desiredCollectionKeys: ["CDEF4567"],
			}),
		).toThrow(NativeItemValidationError);
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: ["CDEF4567"],
				collectionRows,
				itemSourceConnectionKey: "zotero-main",
				desiredCollectionKeys: [],
			}),
		).toThrow("Collections from another source cannot be changed here.");
	});

	it("keeps imported memberships immutable for native items", () => {
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: [],
				collectionRows,
				itemSourceConnectionKey: "native",
				desiredCollectionKeys: ["BCDE3456"],
			}),
		).toThrow("Collections from another source cannot be changed here.");
	});

	it("rejects missing and deleted collections", () => {
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: [],
				collectionRows,
				itemSourceConnectionKey: "zotero-main",
				desiredCollectionKeys: ["FGHJ789A"],
			}),
		).toThrow("selected collections no longer exist");
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: [],
				collectionRows,
				itemSourceConnectionKey: "zotero-main",
				desiredCollectionKeys: ["EFGH6789"],
			}),
		).toThrow("selected collections have been deleted");
	});

	it("allows retaining but not adding a deleted same-source membership", () => {
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: ["EFGH6789"],
				collectionRows,
				itemSourceConnectionKey: "zotero-main",
				desiredCollectionKeys: ["EFGH6789"],
			}),
		).not.toThrow();
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: [],
				collectionRows,
				itemSourceConnectionKey: "zotero-main",
				desiredCollectionKeys: ["EFGH6789"],
			}),
		).toThrow("selected collections have been deleted");
	});

	it("includes persisted draft-only memberships in the retention baseline", () => {
		expect(
			nativeItemCollectionBaselineKeys([], {
				collections: ["CDEF4567"],
			}),
		).toEqual(["CDEF4567"]);
		expect(
			nativeItemCollectionBaselineKeys(["ABCD2345"], {
				collections: ["ABCD2345", "CDEF4567"],
			}),
		).toEqual(["ABCD2345", "CDEF4567"]);
		expect(
			nativeItemCollectionBaselineKeys([], {
				collections: ["CDEF4567", 7, null],
			}),
		).toEqual(["CDEF4567"]);
	});
});
