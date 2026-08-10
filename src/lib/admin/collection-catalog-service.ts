import { and, eq, exists, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "@/db/database-schema";
import { collection } from "@/db/schema/tables/collection";

import {
	decodeAdminCollectionChildrenCursor,
	decodeAdminCollectionSearchCursor,
	encodeAdminCollectionChildrenCursor,
	encodeAdminCollectionSearchCursor,
	parseAdminCollectionChildrenRequest,
	parseAdminCollectionResolveKeys,
	parseAdminCollectionSearchRequest,
	type AdminCollectionChildrenRequest,
	type AdminCollectionSearchRequest,
} from "./collection-catalog-contract";
import { AdminValidationError } from "./errors";
import type {
	AdminCollectionCatalogEntry,
	AdminCollectionCatalogPage,
} from "./types";

const NULL_SORT_ORDER = 2_147_483_647;
const collectionNameSort = sql<string>`lower(coalesce(${collection.name}, ''))`;

function dateString(value: Date | string) {
	return value instanceof Date ? value.toISOString() : value;
}

function containsPattern(value: string) {
	return `%${value.replace(/[\\%_]/gu, "\\$&")}%`;
}

function catalogSelection(database: Database) {
	const child = alias(collection, "child");
	return {
		deleted: collection.deleted,
		hasChildren: exists(
			database
				.select({ value: sql`1` })
				.from(child)
				.where(
					and(
						eq(
							child.sourceConnectionKey,
							collection.sourceConnectionKey,
						),
						eq(child.parentCollection, collection.key),
						eq(child.deleted, 0),
					),
				)
				.limit(1),
		).mapWith(Boolean),
		key: collection.key,
		name: collection.name,
		nameSort: collectionNameSort,
		parentCollection: collection.parentCollection,
		revision: collection.revision,
		sortOrder: collection.sortOrder,
		sourceConnectionKey: collection.sourceConnectionKey,
		updatedAt: collection.updatedAt,
	};
}

type CatalogRow = {
	deleted: number | null;
	hasChildren: boolean;
	key: string;
	name: string | null;
	nameSort: string;
	parentCollection: string | null;
	revision: number;
	sortOrder: number | null;
	sourceConnectionKey: string;
	updatedAt: Date | string;
};

type AncestorRow = {
	depth: number;
	key: string;
	name: string | null;
	targetKey: string;
};

async function ancestorMap(database: Database, keys: string[]) {
	if (keys.length === 0)
		return new Map<string, AdminCollectionCatalogEntry["ancestors"]>();
	const keyParameters = sql.join(
		keys.map((key) => sql`${key}`),
		sql`, `,
	);
	const result = await database.execute<AncestorRow>(sql`
		WITH RECURSIVE ancestor_rows AS (
			SELECT
				target.key AS "targetKey",
				parent.key,
				parent.name,
				parent."parentCollection",
				parent."sourceConnectionKey",
				1 AS depth,
				ARRAY[target.key, parent.key]::varchar[] AS visited
			FROM ${collection} target
			JOIN ${collection} parent
				ON parent.key = target."parentCollection"
				AND parent."sourceConnectionKey" = target."sourceConnectionKey"
			WHERE target.key IN (${keyParameters})

			UNION ALL

			SELECT
				ancestor_rows."targetKey",
				parent.key,
				parent.name,
				parent."parentCollection",
				parent."sourceConnectionKey",
				ancestor_rows.depth + 1,
				ancestor_rows.visited || parent.key
			FROM ancestor_rows
			JOIN ${collection} parent
				ON parent.key = ancestor_rows."parentCollection"
				AND parent."sourceConnectionKey" = ancestor_rows."sourceConnectionKey"
			WHERE NOT parent.key = ANY(ancestor_rows.visited)
		)
		SELECT "targetKey", key, name, depth
		FROM ancestor_rows
		ORDER BY "targetKey", depth DESC
	`);
	const ancestors = new Map<
		string,
		AdminCollectionCatalogEntry["ancestors"]
	>();
	for (const row of result.rows) {
		const current = ancestors.get(row.targetKey) ?? [];
		current.push({
			key: row.key,
			name: row.name?.trim() || "Untitled collection",
		});
		ancestors.set(row.targetKey, current);
	}
	return ancestors;
}

async function hydrateCatalogRows(database: Database, rows: CatalogRow[]) {
	const ancestors = await ancestorMap(
		database,
		rows.map(({ key }) => key),
	);
	return rows.map(
		({ nameSort: _nameSort, ...row }): AdminCollectionCatalogEntry => ({
			...row,
			ancestors: ancestors.get(row.key) ?? [],
			deleted: row.deleted === 1,
			name: row.name?.trim() || "Untitled collection",
			updatedAt: dateString(row.updatedAt),
		}),
	);
}

export async function getAdminCollectionChildrenPage(
	database: Database,
	input: unknown,
): Promise<AdminCollectionCatalogPage> {
	const request = parseAdminCollectionChildrenRequest(input);
	const cursor = request.cursor
		? decodeAdminCollectionChildrenCursor(request.cursor)
		: null;
	if (
		cursor &&
		(cursor.parentCollection !== request.parentCollection ||
			cursor.sourceConnectionKey !== request.sourceConnectionKey)
	) {
		throw new AdminValidationError(
			"The saved collection position does not match this folder. Reload the collections and try again.",
			{ cursor: "Reload this folder to start from the first page." },
		);
	}

	const sortExpression = sql<number>`coalesce(${collection.sortOrder}, ${NULL_SORT_ORDER})`;
	const conditions = [
		eq(collection.sourceConnectionKey, request.sourceConnectionKey),
		eq(collection.deleted, 0),
		request.parentCollection === null
			? sql`${collection.parentCollection} IS NULL`
			: eq(collection.parentCollection, request.parentCollection),
	];
	if (cursor) {
		conditions.push(
			sql`(${sortExpression}, ${collectionNameSort}, ${collection.key}) > (${cursor.sortOrder}, ${cursor.name}, ${cursor.key})`,
		);
	}

	const rows = await database
		.select(catalogSelection(database))
		.from(collection)
		.where(and(...conditions))
		.orderBy(
			sql`${sortExpression} ASC`,
			sql`${collectionNameSort} ASC`,
			sql`${collection.key} ASC`,
		)
		.limit(request.pageSize + 1);
	const hasMore = rows.length > request.pageSize;
	const pageRows = hasMore ? rows.slice(0, request.pageSize) : rows;
	const items = await hydrateCatalogRows(database, pageRows);
	const last = items.at(-1);
	const lastRow = pageRows.at(-1);

	return {
		hasMore,
		items,
		nextCursor:
			hasMore && last
				? encodeAdminCollectionChildrenCursor({
						key: last.key,
						name: lastRow!.nameSort,
						parentCollection: request.parentCollection,
						sortOrder: last.sortOrder ?? NULL_SORT_ORDER,
						sourceConnectionKey: request.sourceConnectionKey,
					})
				: null,
	};
}

export async function searchAdminCollections(
	database: Database,
	input: unknown,
): Promise<AdminCollectionCatalogPage> {
	const request = parseAdminCollectionSearchRequest(input);
	const cursor = request.cursor
		? decodeAdminCollectionSearchCursor(request.cursor)
		: null;
	if (
		cursor &&
		(cursor.query !== request.query.toLowerCase() ||
			cursor.sourceConnectionKey !== request.sourceConnectionKey ||
			cursor.state !== request.state)
	) {
		throw new AdminValidationError(
			"The saved collection search position does not match this search. Search again.",
			{ cursor: "Search again to start from the first result." },
		);
	}

	const conditions: SQL[] = [];
	if (request.query) {
		conditions.push(
			sql`${collectionNameSort} ILIKE ${containsPattern(request.query)} ESCAPE '\\'`,
		);
	}
	if (request.state === "active") conditions.push(eq(collection.deleted, 0));
	if (request.state === "deleted") conditions.push(eq(collection.deleted, 1));
	if (request.sourceConnectionKey) {
		conditions.push(
			eq(collection.sourceConnectionKey, request.sourceConnectionKey),
		);
	}
	if (cursor) {
		conditions.push(
			sql`(${collectionNameSort}, ${collection.sourceConnectionKey}, ${collection.key}) > (${cursor.name}, ${cursor.rowSourceConnectionKey}, ${cursor.key})`,
		);
	}

	const rows = await database
		.select(catalogSelection(database))
		.from(collection)
		.where(and(...conditions))
		.orderBy(
			sql`${collectionNameSort} ASC`,
			sql`${collection.sourceConnectionKey} ASC`,
			sql`${collection.key} ASC`,
		)
		.limit(request.pageSize + 1);
	const hasMore = rows.length > request.pageSize;
	const pageRows = hasMore ? rows.slice(0, request.pageSize) : rows;
	const items = await hydrateCatalogRows(database, pageRows);
	const last = items.at(-1);
	const lastRow = pageRows.at(-1);

	return {
		hasMore,
		items,
		nextCursor:
			hasMore && last
				? encodeAdminCollectionSearchCursor({
						key: last.key,
						name: lastRow!.nameSort,
						query: request.query.toLowerCase(),
						rowSourceConnectionKey: last.sourceConnectionKey,
						sourceConnectionKey: request.sourceConnectionKey,
						state: request.state,
					})
				: null,
	};
}

export async function resolveAdminCollections(
	database: Database,
	input: string[],
) {
	const keys = parseAdminCollectionResolveKeys(input);
	const rows = await database
		.select(catalogSelection(database))
		.from(collection)
		.where(inArray(collection.key, keys));
	const items = await hydrateCatalogRows(database, rows);
	const itemsByKey = new Map(items.map((item) => [item.key, item]));
	return keys.flatMap((key) => {
		const item = itemsByKey.get(key);
		return item ? [item] : [];
	});
}
