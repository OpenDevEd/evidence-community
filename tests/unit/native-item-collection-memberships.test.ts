import { describe, expect, it } from "vitest";

import { NativeItemValidationError } from "@/lib/admin/native-item-validation";
import {
	assertValidNativeItemCollectionMemberships,
	nativeItemCollectionBaselineKeys,
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
		deleted: 1,
		key: "CDEF4567",
		sourceConnectionKey: "native",
	},
];

describe("native item collection memberships", () => {
	it("allows active native memberships and retained imported memberships", () => {
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: ["BCDE3456"],
				collectionRows,
				desiredCollectionKeys: ["ABCD2345", "BCDE3456"],
			}),
		).not.toThrow();
	});

	it("rejects adding or removing imported memberships", () => {
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: [],
				collectionRows,
				desiredCollectionKeys: ["BCDE3456"],
			}),
		).toThrow(NativeItemValidationError);
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: ["BCDE3456"],
				collectionRows,
				desiredCollectionKeys: [],
			}),
		).toThrow(
			"Imported collection memberships cannot be changed here.",
		);
	});

	it("rejects missing and deleted native collections", () => {
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: [],
				collectionRows,
				desiredCollectionKeys: ["DEFG5678"],
			}),
		).toThrow("selected collections no longer exist");
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: [],
				collectionRows,
				desiredCollectionKeys: ["CDEF4567"],
			}),
		).toThrow("selected collections have been deleted");
	});

	it("allows retaining but not adding a deleted native membership", () => {
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: ["CDEF4567"],
				collectionRows,
				desiredCollectionKeys: ["CDEF4567"],
			}),
		).not.toThrow();
		expect(() =>
			assertValidNativeItemCollectionMemberships({
				baselineCollectionKeys: [],
				collectionRows,
				desiredCollectionKeys: ["CDEF4567"],
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
