import { and, eq, inArray, notExists, notInArray, sql } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { EXCLUDED_ITEM_TYPES } from "@/constants/items";

/** Shared visibility for published parents and their attachments. */
export function publicItemVisibility(database: Pick<Database, "select">, hiddenTags: readonly string[]) {
	return and(
		sql`coalesce(${item.deleted}, 0) <> 1`,
		hiddenTags.length ? notExists(database.select({ key: itemToTag.itemKey }).from(itemToTag).where(and(
			eq(itemToTag.itemKey, item.key),
			inArray(sql`lower(${itemToTag.tagName})`, hiddenTags.map(tag => tag.toLowerCase())),
		))) : undefined,
	);
}


export function publicParentVisibility(database: Pick<Database, "select">, hiddenTags: readonly string[]) {
	return and(publicItemVisibility(database, hiddenTags),
		notInArray(sql`${item.itemType}::text`, EXCLUDED_ITEM_TYPES),
		sql`coalesce(${item.parentItem}, '') = ''`,
	);
}
