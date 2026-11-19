import { boolean, pgTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * A record's title or abstract in one language, with the fingerprint of the original it was made from. No foreign key
 * to `item`: the sync service replaces items, and a stale row is ignored once its fingerprint stops matching.
 */
export const recordTranslation = pgTable(
	"record_translation",
	{
		itemKey: varchar("item_key").notNull(),
		part: text("part", { enum: ["title", "abstract"] }).notNull(),
		language: text("language").notNull(),
		fingerprint: text("fingerprint").notNull(),
		/** Empty when the original is already in the language. */
		text: text("text").notNull(),
		same: boolean("same").notNull(),
		/** The original's language, ISO 639-1; titles only. */
		sourceLanguage: text("source_language"),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.itemKey, table.part, table.language] })],
);
