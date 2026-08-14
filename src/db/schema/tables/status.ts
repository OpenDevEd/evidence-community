import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	integer,
	pgTable,
	timestamp,
} from "drizzle-orm/pg-core";

export const status = pgTable(
	"status",
	{
		id: integer("id").primaryKey().default(1),
		totalRecords: integer("totalRecords").notNull().default(0),
		totalItems: integer("totalItems").notNull().default(0),
		searchIndexRebuildPending: boolean("searchIndexRebuildPending")
			.notNull()
			.default(true),
		databaseUpdatedAt: timestamp("databaseUpdatedAt")
			.notNull()
			.defaultNow(),
		createdAt: timestamp("createdAt").notNull().defaultNow(),
		updatedAt: timestamp("updatedAt").notNull().defaultNow(),
	},
	(table) => [check("status_singleton", sql`${table.id} = 1`)],
);
