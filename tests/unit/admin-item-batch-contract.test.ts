import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { adminItemBatchRequestSchema } from "@/lib/admin/item-batch-contract";
import { orderBatchKeysByDependency } from "@/lib/admin/item-batch-service";

describe("admin item batch contract", () => {
	it("accepts every supported batch mutation", () => {
        expect(() => adminItemBatchRequestSchema.parse({ action: "publish", keys: ["ABCD2345"] })).toThrow();
		expect(
			adminItemBatchRequestSchema.parse({
				action: "remove",
				keys: ["ABCD2345"],
			}),
		).toEqual({ action: "remove", keys: ["ABCD2345"] });
		expect(
			adminItemBatchRequestSchema.parse({
				action: "assignCollection",
				collectionKey: "WXYZ6789",
				keys: ["ABCD2345"],
			}),
		).toEqual({
			action: "assignCollection",
			collectionKey: "WXYZ6789",
			keys: ["ABCD2345"],
		});
	});

	it("rejects invalid, duplicate, empty, and oversized selections", () => {
		const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
		const oversizedSelection = Array.from(
			{ length: 51 },
			(_, index) =>
				`AAAAAA${alphabet[Math.floor(index / alphabet.length)]}${
					alphabet[index % alphabet.length]
				}`,
		);
		for (const keys of [
			[],
			["ABCD2345", "ABCD2345"],
			["not-a-key"],
			oversizedSelection,
		]) {
			expect(() =>
				adminItemBatchRequestSchema.parse({ action: "remove", keys }),
			).toThrow();
		}
	});
});

describe("batch item dependency order", () => {
	const parentByKey = new Map([
		["PARENT23", null],
		["CHILD234", "PARENT23"],
		["GRAND234", "CHILD234"],
	]);

	it("removes attachments before their parents", () => {
		expect(
			orderBatchKeysByDependency(
				["PARENT23", "CHILD234", "GRAND234"],
				parentByKey,
			),
		).toEqual(["GRAND234", "CHILD234", "PARENT23"]);
	});

	it("keeps unrelated records stable", () => {
		expect(
			orderBatchKeysByDependency(
				["FIRST234", "SECOND23"],
				new Map(),
			),
		).toEqual(["FIRST234", "SECOND23"]);
	});
});
