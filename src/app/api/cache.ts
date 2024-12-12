import { getItem } from "./item/[key]/route";
import { ItemGetResponse } from "./item/types";

export const cachedItems = new Map<string, ItemGetResponse>();

export async function getCachedItem(key: string) {
	let item = cachedItems.get(key);
	if (!item) {
		item = await getItem(key);
		if (!item || !item.item) {
			return null;
		}
		cachedItems.set(key, item);
	}
	return item;
}