import type { ItemsGetResponse } from "@/app/api/items/types";

export function mergeLastFetchedItems(
	previous: ItemsGetResponse | null,
	fresh: ItemsGetResponse,
): ItemsGetResponse {
	const itemsByKey = new Map(
		[...(previous?.items ?? []), ...fresh.items].map((item) => [
			item.key,
			item,
		]),
	);

	return {
		...fresh,
		items: Array.from(itemsByKey.values()).slice(-100),
	};
}
