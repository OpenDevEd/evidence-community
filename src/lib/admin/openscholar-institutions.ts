import { sql, type SQL } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { itemInstitution } from "@/db/schema/tables/itemInstitution";

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
 * The rows come from the `itemInstitution` projection, which the same refresh
 * function that maintains `adminItemListProjection` keeps in step with the
 * records. Reading a projection means a search uses the trigram index and a
 * page never unpacks a record's creators JSON.
 *
 * Paging is keyset, not offset. The counts come from an aggregate, so the
 * "start after the last row" condition has to sit in HAVING.
 */
export function buildInstitutionCountsQuery(
	request: OpenScholarInstitutionRequest,
	cursor: OpenScholarInstitutionCursor | null,
): SQL {
	// PostgreSQL folds both sides of the match, so a name such as "İstanbul"
	// is found whatever case the search uses. The trigram index serves ILIKE.
	const search = request.query
		? sql` WHERE ${itemInstitution.institutionName} ILIKE ${containsPattern(request.query)} ESCAPE '\\'`
		: sql``;

	const keyset = (() => {
		if (!cursor) return sql``;
		if (request.sort === "name") {
			return sql` HAVING ${itemInstitution.institutionName} > ${cursor.name}`;
		}
		return sql` HAVING (
			count(*) < ${cursor.count}
			OR (count(*) = ${cursor.count} AND ${itemInstitution.institutionName} > ${cursor.name})
		)`;
	})();

	const order =
		request.sort === "name"
			? sql`${itemInstitution.institutionName} ASC`
			: sql`count(*) DESC, ${itemInstitution.institutionName} ASC`;

	return sql`
		SELECT ${itemInstitution.institutionName} AS name, count(*) AS count
		FROM ${itemInstitution}${search}
		GROUP BY ${itemInstitution.institutionName}${keyset}
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
