import { pgTable, varchar } from "drizzle-orm/pg-core";

/** An old record key that `/lib/{key}` sends to the record's current key, when `generation.redirects` is on. */
export const itemRedirect = pgTable("itemRedirect", {
	fromKey: varchar("fromKey").primaryKey(),
	toKey: varchar("toKey").notNull(),
});
