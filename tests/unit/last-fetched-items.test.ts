import { describe, expect, it } from "vitest";

import type { ItemsGetResponse } from "@/app/api/items/types";
import { mergeLastFetchedItems } from "@/lib/last-fetched-items";

function response(
	items: Array<{ citation?: string | null; key: string; title: string }>,
) {
	return {
		currentPage: 1,
		items,
		perPage: 20,
		totalItems: items.length,
		totalPages: 1,
	} as ItemsGetResponse;
}

describe("last fetched item cache", () => {
	it("keeps the newest record without changing its citation", () => {
		const previous = response([
			{ citation: "Old citation.", key: "ITEM01", title: "Old title" },
		]);
		const fresh = response([
			{
				citation: "Fresh indexed citation.",
				key: "ITEM01",
				title: "Fresh title",
			},
		]);

		const merged = mergeLastFetchedItems(previous, fresh);

		expect(merged.items).toHaveLength(1);
		expect(merged.items[0]).toMatchObject({
			citation: "Fresh indexed citation.",
			key: "ITEM01",
			title: "Fresh title",
		});
		expect(fresh.items[0]?.citation).toBe("Fresh indexed citation.");
	});
});
