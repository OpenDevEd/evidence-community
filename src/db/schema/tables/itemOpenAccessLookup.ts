import { bigint, boolean, foreignKey, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

import { item } from "./item";

/** What OpenAlex said about the DOI a record shows, for records not imported from OpenAlex. */
export const itemOpenAccessLookup = pgTable(
	"itemOpenAccessLookup",
	{
		itemKey: varchar("itemKey", { length: 8 }).primaryKey(),
		/** The record's revision when it was last looked at; a newer one is looked at again in case its DOI changed. */
		itemRevision: bigint("itemRevision", { mode: "number" }).notNull(),
		/** The DOI the record showed then, normalised; null when it showed none. */
		doi: varchar("doi"),
		/** Null when the record has no DOI OpenAlex could be asked about, or OpenAlex has no work with it. */
		isOpenAccess: boolean("isOpenAccess"),
		checkedAt: timestamp("checkedAt", { withTimezone: true }).notNull(),
	},
	(table) => [
		foreignKey({
			name: "itemOpenAccessLookup_item_fk",
			columns: [table.itemKey],
			foreignColumns: [item.key],
		}).onDelete("cascade"),
	],
);
