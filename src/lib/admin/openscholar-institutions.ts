import { sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";

type InstitutionCountRow = { count: number | string; name: string };

/**
 * Every institution named on a live top-level record, with how many records
 * name it. Unlike the public institutions page this is not limited to the
 * most common country: OpenScholar pickers need the full list.
 */
export async function listInstitutionCounts(database: Database) {
	const result = await database.execute<InstitutionCountRow>(sql`
		SELECT institution_name AS name, count(*) AS count
		FROM (
			SELECT DISTINCT
				institution_data->>'display_name' AS institution_name,
				${item.key} AS item_key
			FROM ${item},
			LATERAL jsonb_array_elements(${item.creators}) AS creator_data,
			LATERAL jsonb_array_elements(creator_data->'institutions') AS institution_data
			WHERE ${item.deleted} = 0
			AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
			AND jsonb_typeof(${item.creators}) = 'array'
			AND jsonb_typeof(creator_data->'institutions') = 'array'
			AND coalesce(institution_data->>'display_name', '') <> ''
		) AS institution_items
		GROUP BY institution_name
		ORDER BY count(*) DESC, institution_name ASC
	`);
	return result.rows.map((row) => ({
		count: Number(row.count),
		name: row.name,
	}));
}
