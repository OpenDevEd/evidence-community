import { and, eq, inArray, notExists, notInArray, sql, type AnyColumn } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { itemReading } from "@/db/schema/readings";
import { EXCLUDED_ITEM_TYPES } from "@/constants/items";

/**
 * Shared visibility for published parents and their attachments: not deleted, not tagged hidden, and not screened out by
 * the sources that hold it. `row` is the item table, or an alias of it when the visible row is not the outer one (an
 * attachment in a subquery).
 */
export function publicItemVisibility(database: Pick<Database, "select">, hiddenTags: readonly string[], row: { deleted: AnyColumn; key: AnyColumn } = item) {
	return and(
		sql`coalesce(${row.deleted}, 0) <> 1`,
		hiddenTags.length ? notExists(database.select({ key: itemToTag.itemKey }).from(itemToTag).where(and(
			eq(itemToTag.itemKey, row.key),
			inArray(sql`lower(${itemToTag.tagName})`, hiddenTags.map(tag => tag.toLowerCase())),
		))) : undefined,
		notExists(database.select({ key: itemReading.itemKey }).from(itemReading).where(and(eq(itemReading.itemKey, row.key), eq(itemReading.screenedOut, true)))),
	);
}


/** `row` is the item table, or an alias of it. */
export function publicParentVisibility(
	database: Pick<Database, "select">,
	hiddenTags: readonly string[],
	row: { deleted: AnyColumn; key: AnyColumn; itemType: AnyColumn; parentItem: AnyColumn } = item,
) {
	return and(publicItemVisibility(database, hiddenTags, row),
		notInArray(sql`${row.itemType}::text`, EXCLUDED_ITEM_TYPES),
		sql`coalesce(${row.parentItem}, '') = ''`,
	);
}
