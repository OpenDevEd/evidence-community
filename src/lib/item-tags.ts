import { inArray } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { itemToTag } from "@/db/schema/tables/itemToTag";

export async function readItemTags(database: Pick<Database, "select">, keys: readonly string[]) {
	const tagsByKey = new Map<string, string[]>();
	if (!keys.length) return tagsByKey;
	const rows = await database.select({ itemKey: itemToTag.itemKey, tagName: itemToTag.tagName })
		.from(itemToTag).where(inArray(itemToTag.itemKey, [...keys]));
	for (const row of rows) {
		const tags = tagsByKey.get(row.itemKey);
		if (tags) tags.push(row.tagName);
		else tagsByKey.set(row.itemKey, [row.tagName]);
	}
	return tagsByKey;
}
