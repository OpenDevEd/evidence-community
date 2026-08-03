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
		await client.query("ROLLBACK");
		console.log(
			JSON.stringify({
				rows: ROW_COUNT,
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
