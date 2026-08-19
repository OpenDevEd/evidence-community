import { sql } from "drizzle-orm";
import {
	check,
	index,
	pgTable,
	primaryKey,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";

import { item } from "./item";

export const ITEM_LINK_KINDS = ["cites", "related"] as const;
export type ItemLinkKind = (typeof ITEM_LINK_KINDS)[number];

export const MANUAL_ITEM_LINK_ORIGIN = "manual";
export const SOURCE_ITEM_LINK_ORIGIN_PREFIX = "source:";

/**
 * One directed link between two library records, as asserted by one owner.
 * "Cited by" and "related to this record" are read with a reverse query, never copied.
 * `origin` says who owns the row: the editor (`manual`) or a source (`source:<key>`).
 * The same pair may be asserted by several owners; readers de-duplicate the logical link.
 */
export const itemLink = pgTable(
	"itemLink",
	{
		fromKey: varchar({ length: 8 })
			.notNull()
			.references(() => item.key, { onDelete: "cascade" }),
		toKey: varchar({ length: 8 })
			.notNull()
			.references(() => item.key, { onDelete: "cascade" }),
		kind: varchar({ length: 16 }).notNull().$type<ItemLinkKind>(),
		origin: varchar({ length: 72 }).notNull(),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		primaryKey({
			columns: [table.fromKey, table.toKey, table.kind, table.origin],
		}),
		index("itemLink_to_idx").on(table.toKey, table.kind),
		index("itemLink_origin_idx").on(table.origin, table.fromKey),
		check("itemLink_not_self", sql`${table.fromKey} <> ${table.toKey}`),
		check("itemLink_kind_valid", sql`${table.kind} in ('cites', 'related')`),
		check(
			"itemLink_origin_valid",
			sql`${table.origin} = 'manual' or ${table.origin} ~ '^source:[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'`,
		),
	],
);
