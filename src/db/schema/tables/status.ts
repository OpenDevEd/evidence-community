import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const status = pgTable(
	"status",
	{
		id: integer("id").primaryKey().default(1),
		totalRecords: integer("totalRecords").notNull().default(0),
		totalItems: integer("totalItems").notNull().default(0),
		searchProjectionSignature: text("searchProjectionSignature"),
		searchIndexRebuildPending: boolean("searchIndexRebuildPending")
			.notNull()
			.default(true),
		/** The engine whose index holds every record, which readers search; set by the search worker. */
		searchEngine: text("searchEngine", { enum: ["elasticsearch", "meilisearch"] }),
		databaseUpdatedAt: timestamp("databaseUpdatedAt")
			.notNull()
			.defaultNow(),
		createdAt: timestamp("createdAt").notNull().defaultNow(),
		updatedAt: timestamp("updatedAt").notNull().defaultNow(),
	},
	(table) => [
		check("status_singleton", sql`${table.id} = 1`),
		check("status_search_engine", sql`${table.searchEngine} IN ('elasticsearch', 'meilisearch')`),
	],
);
