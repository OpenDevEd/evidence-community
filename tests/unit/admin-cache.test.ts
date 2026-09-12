import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminSearchIndexReceiptStatus } from "@/lib/admin/search-index-contract";

const mocks = vi.hoisted(() => ({
	revalidateTag: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
	revalidateTag: mocks.revalidateTag,
}));

import { revalidateIndexedReceiptCaches } from "@/lib/admin/cache";

function receipt(
	entityKey: string,
	entityType: "collection" | "item",
	state: AdminSearchIndexReceiptStatus["state"],
): AdminSearchIndexReceiptStatus {
	return {
		attempts: 0,
		createdAt: "2026-08-13T12:00:00.000Z",
		entityKey,
		entityType,
		error: null,
		nextAttemptAt: "2026-08-13T12:00:00.000Z",
		processedAt:
			state === "indexed" ? "2026-08-13T12:00:01.000Z" : null,
		revision: 1,
		state,
	};
}

describe("indexed receipt cache invalidation", () => {
	beforeEach(() => mocks.revalidateTag.mockReset());

	it("immediately expires every Next.js tag affected by indexed receipts", () => {
		revalidateIndexedReceiptCaches([
			receipt("ITEM0001", "item", "indexed"),
			receipt("COLL0001", "collection", "indexed"),
			receipt("ITEM0001", "item", "indexed"),
		]);

		expect(mocks.revalidateTag.mock.calls).toEqual([
			["item-citation-source-ITEM0001", { expire: 0 }],
			["metadata-citation-ITEM0001", { expire: 0 }],
			["collections", { expire: 0 }],
		]);
	});

	it("does not expire caches for unfinished or failed receipts", () => {
		revalidateIndexedReceiptCaches([
			receipt("QUEUED01", "item", "queued"),
			receipt("ACTIVE01", "item", "processing"),
			receipt("RETRY001", "item", "retrying"),
			receipt("FAILED01", "item", "failed"),
			receipt("UNKNOWN1", "item", "unknown"),
		]);

		expect(mocks.revalidateTag).not.toHaveBeenCalled();
	});
});
