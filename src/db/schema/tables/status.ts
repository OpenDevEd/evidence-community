import { integer, timestamp, uuid, text } from "drizzle-orm/pg-core";

import { pgTable } from "drizzle-orm/pg-core";

export const status = pgTable("status", {
	id: uuid("id").primaryKey().defaultRandom(),
	totalRecords: integer("totalRecords"),
	totalItems: integer("totalItems"),
	databaseUpdatedAt: timestamp("databaseUpdatedAt"),
	companyName: text("companyName"),
	companyLogo: text("companyLogo"),
	style: text("style"),
	allRISURL: text("allRISURL"),
	allBibTeXURL: text("allBibTeXURL"),
	createdAt: timestamp("createdAt").defaultNow(),
	updatedAt: timestamp("updatedAt").defaultNow(),
});
