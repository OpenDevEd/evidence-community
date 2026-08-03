import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import type { Database } from "../src/db/database-schema";
import {
	ADMIN_ITEM_SORT_COLUMN_IDS,
	type AdminItemSortColumnId,
} from "../src/lib/admin/item-list-contract";
import { getAdminItemListPage } from "../src/lib/admin/item-list-query";
import { createAdminItemListFixture } from "./adminItemListFixture";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");

const ROW_COUNT = 257;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function walkSort(
	database: Database,
	column: AdminItemSortColumnId,
	direction: "asc" | "desc",
) {
	const keys: string[] = [];
	let cursor: string | null = null;
	do {
		const page = await getAdminItemListPage(database, {
			cursor,
			pageSize: 7,
			sorting: [{ column, direction }],
		});
		keys.push(...page.items.map(({ key }) => key));
		cursor = page.nextCursor;
	} while (cursor);

	assert(keys.length === ROW_COUNT, `${column}:${direction} skipped rows`);
	assert(
		new Set(keys).size === ROW_COUNT,
		`${column}:${direction} returned duplicate rows`,
	);
}

async function verifyRelationFilters(database: Database) {
	const collectionPage = await getAdminItemListPage(database, {
		filters: [
			{
				column: "collections",
				operator: "anyOf",
				value: ["collection-7"],
			},
		],
		pageSize: 100,
	});
	assert(
		collectionPage.items.length === 2 &&
			collectionPage.items.every(({ collections }) =>
				collections.includes("collection-7"),
			),
		"Collection overlap filter returned the wrong records",
	);

	const tagPage = await getAdminItemListPage(database, {
		filters: [
			{
				column: "tags",
				operator: "anyOf",
				value: ["tag-7", "tag-8"],
			},
		],
		pageSize: 100,
	});
	assert(
		tagPage.items.length === 2 &&
			tagPage.items.every(({ tags }) =>
				tags.some((tag) => tag === "tag-7" || tag === "tag-8"),
			),
		"Tag overlap filter returned the wrong records",
	);
}

async function verify() {
	const client = new Client({ connectionString: databaseUrl });
	await client.connect();
	const database = drizzle(client) as unknown as Database;
	try {
		await client.query("BEGIN");
		await createAdminItemListFixture(client, ROW_COUNT);
		for (const column of ADMIN_ITEM_SORT_COLUMN_IDS) {
			await walkSort(database, column, "asc");
			await walkSort(database, column, "desc");
		}
		await verifyRelationFilters(database);
		await client.query("ROLLBACK");
		console.log(
			JSON.stringify({
				rows: ROW_COUNT,
				relationFilters: 2,
				sorts: ADMIN_ITEM_SORT_COLUMN_IDS.length * 2,
			}),
		);
	} finally {
		await client.end();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
