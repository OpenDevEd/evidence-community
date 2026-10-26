import { jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/** Values that take long to compute, such as library statistics, kept so a page can show the last one at once. */
export const computedCache = pgTable("computedCache", {
	key: varchar("key").primaryKey(),
	value: jsonb("value").notNull(),
	/** When the value was computed; a caller may compute a newer one behind it once it is old enough. */
	computedAt: timestamp("computedAt", { withTimezone: true }).notNull(),
});
