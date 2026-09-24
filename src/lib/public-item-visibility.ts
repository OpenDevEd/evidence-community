import { and, eq, inArray, notExists, notInArray, sql, type AnyColumn } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { EXCLUDED_ITEM_TYPES } from "@/constants/items";

/** Shared visibility for published parents and their attachments. */
/** `row` is the item table, or an alias of it when the visible row is not the outer one (an attachment in a subquery). */
export function publicItemVisibility(database: Pick<Database, "select">, hiddenTags: readonly string[], row: { deleted: AnyColumn; key: AnyColumn } = item) {
	return and(
		sql`coalesce(${row.deleted}, 0) <> 1`,
		hiddenTags.length ? notExists(database.select({ key: itemToTag.itemKey }).from(itemToTag).where(and(
			eq(itemToTag.itemKey, row.key),
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
