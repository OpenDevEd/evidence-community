import { sql, type SQL } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";

import {
	encodeOpenScholarInstitutionCursor,
	institutionCursorFor,
	parseOpenScholarInstitutionRequest,
	type OpenScholarInstitutionCursor,
	type OpenScholarInstitutionRequest,
} from "./institution-catalog-contract";

type InstitutionCountRow = { count: number | string; name: string };

export type OpenScholarInstitution = { count: number; name: string };

export type OpenScholarInstitutionPage = {
	items: OpenScholarInstitution[];
	nextCursor: string | null;
};

function containsPattern(value: string) {
	return `%${value.replace(/[\\%_]/gu, "\\$&")}%`;
}

/**
 * One page of the institutions named on live top-level records, with how many
 * records name each one. Unlike the public institutions page this is not
 * limited to the most common country: OpenScholar pickers need the full list.
 *
 * Paging is keyset, not offset. The counts come from an aggregate, so the
 * "start after the last row" condition has to sit in HAVING.
 */
export function buildInstitutionCountsQuery(
	request: OpenScholarInstitutionRequest,
	cursor: OpenScholarInstitutionCursor | null,
): SQL {
	const searchCondition = request.query
		? sql` AND institution_data->>'display_name' ILIKE ${containsPattern(request.query)} ESCAPE '\\'`
		: sql``;

	const keyset = (() => {
		if (!cursor) return sql``;
		if (request.sort === "name") {
			return sql` HAVING institution_name > ${cursor.name}`;
		}
		return sql` HAVING (
			count(*) < ${cursor.count}
			OR (count(*) = ${cursor.count} AND institution_name > ${cursor.name})
		)`;
	})();

	const order =
		request.sort === "name"
			? sql`institution_name ASC`
			: sql`count(*) DESC, institution_name ASC`;

	return sql`
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
			AND coalesce(institution_data->>'display_name', '') <> ''${searchCondition}
		) AS institution_items
		GROUP BY institution_name${keyset}
		ORDER BY ${order}
		LIMIT ${request.pageSize + 1}
	`;
}

export async function listInstitutionCounts(
	database: Database,
	input: unknown,
): Promise<OpenScholarInstitutionPage> {
	const request = parseOpenScholarInstitutionRequest(input);
	const cursor = institutionCursorFor(request);
	const result = await database.execute<InstitutionCountRow>(
		buildInstitutionCountsQuery(request, cursor),
	);
	const rows = result.rows.map(
		(row): OpenScholarInstitution => ({
			count: Number(row.count),
			name: row.name,
		}),
	);
	const hasMore = rows.length > request.pageSize;
	const items = hasMore ? rows.slice(0, request.pageSize) : rows;
	const last = items.at(-1);

	return {
		items,
		nextCursor:
			hasMore && last
				? encodeOpenScholarInstitutionCursor({
						count: last.count,
						name: last.name,
						query: request.query.toLowerCase(),
						sort: request.sort,
					})
				: null,
	};
}
