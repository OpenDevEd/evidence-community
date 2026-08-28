import { index, pgTable, primaryKey, text, varchar } from "drizzle-orm/pg-core";

import { item } from "./item";

/**
 * One row for every institution named on a live top-level record. The runtime
 * keeps it in step with `item` through the same refresh function that
 * maintains `adminItemListProjection`, so the OpenScholar institution picker
 * can search and page without unpacking every record's creators JSON.
 */
export const itemInstitution = pgTable(
	"itemInstitution",
	{
		itemKey: varchar("itemKey", { length: 8 })
			.notNull()
			.references(() => item.key, { onDelete: "cascade" }),
		institutionName: text("institutionName").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.itemKey, table.institutionName] }),
		index("itemInstitution_name_idx").on(
			table.institutionName,
			table.itemKey,
		),
		// PostgreSQL matches the search, so a name such as "İstanbul" folds the
		// same way on both sides. The trigram index serves ILIKE.
		index("itemInstitution_name_search_idx").using(
			"gin",
			table.institutionName.op("gin_trgm_ops"),
		),
	],
);
