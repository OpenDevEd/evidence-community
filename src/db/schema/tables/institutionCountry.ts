import { doublePrecision, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * The country of an institution name, set once for the whole library. Records
 * and authors name institutions in plain text, so the key is the folded name
 * from `institutionNameKey`. A name with no known country has no row.
 */
export const institutionCountry = pgTable("institutionCountry", {
	nameKey: text("nameKey").primaryKey(),
	countryCode: varchar("countryCode", { length: 2 }).notNull(),
	// Set when the country came from an OpenAlex institution, null when an
	// editor chose it by hand.
	openalexId: text("openalexId"),
	city: text("city"),
	// Where OpenAlex places the institution, set for one with an `openalexId`
	// once looked up. Both or neither.
	latitude: doublePrecision("latitude"),
	longitude: doublePrecision("longitude"),
	updatedAt: timestamp("updatedAt", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
