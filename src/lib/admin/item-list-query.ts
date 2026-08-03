import {
	and,
	arrayOverlaps,
	eq,
	inArray,
	isNotNull,
	isNull,
	lt,
	sql,
	type SQL,
} from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/db/database-schema";
import { adminItemListProjection } from "@/db/schema/tables/adminItemListProjection";

import {
	parseAdminItemListRequest,
	type AdminItemListRequest,
} from "./item-list-contract";
import { AdminValidationError } from "./errors";
import type { AdminItemListPage, AdminItemListRow } from "./types";

const cursorSchema = z
	.object({
		v: z.literal(1),
		column: z.enum([
			"title",
			"year",
			"updated",
			"itemType",
			"pageCount",
		]),
		direction: z.enum(["asc", "desc"]),
		key: z.string().length(8),
		nullRank: z.union([z.literal(0), z.literal(1)]),
		value: z.union([z.string(), z.number(), z.null()]),
	})
	.superRefine((cursor, context) => {
		const validValue = (() => {
			if (cursor.nullRank === 1) {
				return (
					(cursor.column === "year" ||
						cursor.column === "pageCount") &&
					cursor.value === null
				);
			}
			if (cursor.column === "year" || cursor.column === "pageCount") {
				return typeof cursor.value === "number";
			}
			if (cursor.column === "updated") {
				return (
					typeof cursor.value === "string" &&
					Number.isFinite(Date.parse(cursor.value))
				);
			}
			return typeof cursor.value === "string";
		})();
		if (!validValue) {
			context.addIssue({
				code: "custom",
				message: "Cursor value does not match its sort column",
				path: ["value"],
			});
		}
	});

export type AdminItemCursor = Omit<z.infer<typeof cursorSchema>, "v">;

export function encodeAdminItemCursor(cursor: AdminItemCursor) {
	return Buffer.from(JSON.stringify({ v: 1, ...cursor }), "utf8").toString(
		"base64url",
	);
}

export function decodeAdminItemCursor(encoded: string): AdminItemCursor {
	try {
		const { v: _version, ...cursor } = cursorSchema.parse(
			JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
		);
		return cursor;
	} catch {
		throw new AdminValidationError(
			"The saved list position is invalid or expired. Reload the records and try again.",
			{ cursor: "Reload the records to start from the first page." },
		);
	}
}

type ProjectionColumn =
	| typeof adminItemListProjection.titleSort
	| typeof adminItemListProjection.year
	| typeof adminItemListProjection.updatedAt
	| typeof adminItemListProjection.itemType
	| typeof adminItemListProjection.pageCount;

function sortColumn(column: AdminItemCursor["column"]): ProjectionColumn {
	switch (column) {
		case "title":
			return adminItemListProjection.titleSort;
		case "year":
			return adminItemListProjection.year;
		case "updated":
			return adminItemListProjection.updatedAt;
		case "itemType":
			return adminItemListProjection.itemType;
		case "pageCount":
			return adminItemListProjection.pageCount;
	}
}

function sortExpression(
	column: AdminItemCursor["column"],
	direction: AdminItemCursor["direction"],
) {
	const projectedColumn = sortColumn(column);
	if (column === "year" || column === "pageCount") {
		return direction === "asc"
			? sql`coalesce(${projectedColumn}, ${sql.raw("2147483647")})`
			: sql`coalesce(${projectedColumn}, ${sql.raw("-2147483648")})`;
	}
	return sql`${projectedColumn}`;
}

function textArray(value: unknown) {
	return value as string[];
}

function numberValue(value: unknown) {
	return value as number;
}

function numberRange(value: unknown) {
	return value as [number, number];
}

function dateRange(value: unknown) {
	return value as [string, string];
}

function containsPattern(value: unknown) {
	return `%${String(value).replace(/[\\%_]/gu, "\\$&")}%`;
}

function listFilter(
	filter: AdminItemListRequest["filters"][number],
): SQL | undefined {
	const column = (() => {
		switch (filter.column) {
			case "title":
				return adminItemListProjection.title;
			case "year":
				return adminItemListProjection.year;
			case "state":
				return adminItemListProjection.state;
			case "fileState":
				return adminItemListProjection.fileState;
			case "updated":
				return adminItemListProjection.updatedAt;
			case "itemType":
				return adminItemListProjection.itemType;
			case "source":
				return adminItemListProjection.sourceConnectionKey;
			case "dateAdded":
				return adminItemListProjection.dateAdded;
			case "key":
				return adminItemListProjection.key;
			case "revision":
				return adminItemListProjection.revision;
			case "pageCount":
				return adminItemListProjection.pageCount;
			default:
				return undefined;
		}
	})();

	if (filter.column === "creators") {
		if (filter.operator === "hasValue") {
			return sql`cardinality(${adminItemListProjection.creatorNames}) > 0`;
		}
		if (filter.operator === "hasNoValue") {
			return sql`cardinality(${adminItemListProjection.creatorNames}) = 0`;
		}
		return sql`EXISTS (
			SELECT 1 FROM unnest(${adminItemListProjection.creatorNames}) name
			WHERE name ILIKE ${containsPattern(filter.value)} ESCAPE '\\'
		)`;
	}

	if (filter.column === "collections" || filter.column === "tags") {
		const relationColumn =
			filter.column === "collections"
				? adminItemListProjection.collections
				: adminItemListProjection.tags;
		if (filter.operator === "hasValue") {
			return sql`cardinality(${relationColumn}) > 0`;
		}
		if (filter.operator === "hasNoValue") {
			return sql`cardinality(${relationColumn}) = 0`;
		}
		return arrayOverlaps(relationColumn, textArray(filter.value));
	}

	if (!column) return undefined;
	switch (filter.operator) {
		case "contains":
			return sql`${column}::text ILIKE ${containsPattern(filter.value)} ESCAPE '\\'`;
		case "equals":
			return typeof filter.value === "number"
				? eq(column, numberValue(filter.value))
				: sql`lower(${column}::text) = lower(${String(filter.value)})`;
		case "anyOf":
			return inArray(column, textArray(filter.value));
		case "hasValue":
			return isNotNull(column);
		case "hasNoValue":
			return isNull(column);
		case "before":
			return lt(column, new Date(String(filter.value)));
		case "after": {
			const nextDay = new Date(`${String(filter.value)}T00:00:00.000Z`);
			nextDay.setUTCDate(nextDay.getUTCDate() + 1);
			return sql`${column} >= ${nextDay}`;
		}
		case "between": {
			if (filter.column === "updated" || filter.column === "dateAdded") {
				const [start, end] = dateRange(filter.value);
				const exclusiveEnd = new Date(`${end}T00:00:00.000Z`);
				exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
				return and(
					sql`${column} >= ${new Date(start)}`,
					sql`${column} < ${exclusiveEnd}`,
				);
			}
			const [start, end] = numberRange(filter.value);
			return and(sql`${column} >= ${start}`, sql`${column} <= ${end}`);
		}
	}
}

function cursorPredicate(
	cursor: AdminItemCursor,
	expression: SQL,
): SQL {
	const cursorValue = cursor.nullRank === 1
		? cursor.direction === "asc"
			? 2_147_483_647
			: -2_147_483_648
		: cursor.column === "updated"
			? new Date(String(cursor.value))
			: cursor.value!;
	return cursor.direction === "asc"
		? sql`(${expression}, ${adminItemListProjection.key}) > (${cursorValue}, ${cursor.key})`
		: sql`(${expression}, ${adminItemListProjection.key}) < (${cursorValue}, ${cursor.key})`;
}

function rowCursor(
	row: AdminItemListRow & { titleSort: string },
	column: AdminItemCursor["column"],
	direction: AdminItemCursor["direction"],
) {
	const value = (() => {
		switch (column) {
			case "title":
				return row.titleSort;
			case "year":
				return row.year;
			case "updated":
				return row.updatedAt;
			case "itemType":
				return row.itemType;
			case "pageCount":
				return row.pageCount;
		}
	})();
	return encodeAdminItemCursor({
		column,
		direction,
		key: row.key,
		nullRank: value === null ? 1 : 0,
		value,
	});
}

function dateString(value: Date | string | null) {
	if (!value) return null;
	return value instanceof Date ? value.toISOString() : value;
}

export async function getAdminItemListPage(
	database: Database,
	input: Partial<AdminItemListRequest> = {},
): Promise<AdminItemListPage> {
	const { query, request, sorting } = buildAdminItemListQuery(database, input);
	const rows = await query;
	const hasMore = rows.length > request.pageSize;
	const pageRowsWithSort = (
		hasMore ? rows.slice(0, request.pageSize) : rows
	).map((row) => ({
			...row,
			dateAdded: dateString(row.dateAdded),
			updatedAt: dateString(row.updatedAt)!,
		}));
	const last = pageRowsWithSort.at(-1);
	const pageRows = pageRowsWithSort.map(
		({ titleSort: _titleSort, ...row }) => row,
	);
	return {
		hasMore,
		items: pageRows,
		nextCursor:
			hasMore && last
				? rowCursor(last, sorting.column, sorting.direction)
				: null,
	};
}

export function buildAdminItemListQuery(
	database: Database,
	input: Partial<AdminItemListRequest> = {},
) {
	const request = parseAdminItemListRequest(input);
	const sorting = request.sorting[0]!;
	const expression = sortExpression(sorting.column, sorting.direction);
	const cursor = request.cursor
		? decodeAdminItemCursor(request.cursor)
		: null;
	if (
		cursor &&
		(cursor.column !== sorting.column ||
			cursor.direction !== sorting.direction)
	) {
		throw new AdminValidationError(
			"The saved list position does not match the current sort. Reload the records and try again.",
			{ cursor: "Reload the records to start from the first page." },
		);
	}

	const conditions = request.filters
		.map(listFilter)
		.filter((condition): condition is SQL => Boolean(condition));
	if (request.search) {
		conditions.push(
			sql`${adminItemListProjection.searchText} ILIKE ${containsPattern(request.search)} ESCAPE '\\'`,
		);
	}
	if (cursor) conditions.push(cursorPredicate(cursor, expression));

	const query = database
		.select({
			collections: adminItemListProjection.collections,
			creatorNames: adminItemListProjection.creatorNames,
			creators: adminItemListProjection.creators,
			date: adminItemListProjection.date,
			dateAdded: adminItemListProjection.dateAdded,
			fileState: adminItemListProjection.fileState,
			itemType: adminItemListProjection.itemType,
			key: adminItemListProjection.key,
			pageCount: adminItemListProjection.pageCount,
			revision: adminItemListProjection.revision,
			sourceConnectionKey:
				adminItemListProjection.sourceConnectionKey,
			state: adminItemListProjection.state,
			tags: adminItemListProjection.tags,
			title: adminItemListProjection.title,
			titleSort: adminItemListProjection.titleSort,
			updatedAt: adminItemListProjection.updatedAt,
			year: adminItemListProjection.year,
		})
		.from(adminItemListProjection)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(
			sorting.direction === "asc"
				? sql`${expression} ASC`
				: sql`${expression} DESC`,
			sorting.direction === "asc"
				? sql`${adminItemListProjection.key} ASC`
				: sql`${adminItemListProjection.key} DESC`,
		)
		.limit(request.pageSize + 1);
	return { query, request, sorting };
}
