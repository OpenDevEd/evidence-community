import { integer, timestamp, uuid } from "drizzle-orm/pg-core";

import { pgTable } from "drizzle-orm/pg-core";

export const status = pgTable("status", {
	id: uuid("id").primaryKey().defaultRandom(),
	totalRecords: integer("totalRecords"),
	totalItems: integer("totalItems"),
	databaseUpdatedAt: timestamp("databaseUpdatedAt"),
	createdAt: timestamp("createdAt").defaultNow(),
	updatedAt: timestamp("updatedAt").defaultNow(),
});
