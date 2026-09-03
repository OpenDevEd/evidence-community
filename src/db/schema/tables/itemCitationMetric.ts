import { itemSourceLink } from "@opendeved/evidence-library-core";
import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	primaryKey,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";

export const itemCitationMetric = pgTable(
	"itemCitationMetric",
	{
		itemKey: varchar("itemKey", { length: 8 }).notNull(),
		sourceConnectionKey: varchar("sourceConnectionKey", {
			length: 64,
		}).notNull(),
		citedByCount: integer("citedByCount"),
		referencedWorksCount: integer("referencedWorksCount"),
		observedAt: timestamp("observedAt", { withTimezone: true }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.itemKey, table.sourceConnectionKey] }),
		foreignKey({
			name: "itemCitationMetric_item_source_link_fk",
			columns: [table.itemKey, table.sourceConnectionKey],
			foreignColumns: [
				itemSourceLink.itemKey,
				itemSourceLink.sourceConnectionKey,
			],
		}).onDelete("cascade"),
		index("itemCitationMetric_source_idx").on(
			table.sourceConnectionKey,
			table.itemKey,
		),
		check(
			"itemCitationMetric_has_count",
			sql`${table.citedByCount} IS NOT NULL OR ${table.referencedWorksCount} IS NOT NULL`,
		),
		check(
			"itemCitationMetric_cited_by_nonnegative",
			sql`${table.citedByCount} IS NULL OR ${table.citedByCount} >= 0`,
		),
		check(
			"itemCitationMetric_references_nonnegative",
			sql`${table.referencedWorksCount} IS NULL OR ${table.referencedWorksCount} >= 0`,
		),
	],
);
