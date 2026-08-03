import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import type { Database } from "../src/db/database-schema";
import {
	getAdminCollectionChildrenPage,
	resolveAdminCollections,
	searchAdminCollections,
} from "../src/lib/admin/collection-catalog-service";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");

const COLLECTION_COUNT = 50_000;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function createFixture(client: Client) {
	await client.query(`
		CREATE TEMP TABLE "collection" (
			key varchar(8) PRIMARY KEY,
			"sourceConnectionKey" varchar(64) NOT NULL,
			"sourceRecordKey" varchar(255),
			revision bigint NOT NULL,
			"numCollections" integer,
			"numItems" integer,
			name varchar,
			deleted integer,
			"deletedAt" timestamptz,
			"sortOrder" integer,
			"parentCollection" varchar(8),
			relations jsonb,
			"createdAt" timestamptz NOT NULL,
			"updatedAt" timestamptz NOT NULL
		) ON COMMIT DROP
	`);
	await client.query(
		`
			INSERT INTO "collection" (
				key, "sourceConnectionKey", revision, name, deleted, "sortOrder",
				"parentCollection", "createdAt", "updatedAt"
			)
			SELECT
				'C' || lpad(value::text, 7, '0'),
				'native',
				1,
				CASE
					WHEN value % 1000 = 0 THEN 'Shared collection'
					ELSE 'Collection ' || lpad(value::text, 5, '0')
				END,
				CASE WHEN value % 997 = 0 THEN 1 ELSE 0 END,
				value,
				CASE
					WHEN value <= 10000 THEN NULL
					ELSE 'C' || lpad((((value - 10001) % 10000) + 1)::text, 7, '0')
				END,
				now(),
				now()
			FROM generate_series(1, $1) value
		`,
		[COLLECTION_COUNT],
	);
	await client.query(`
		INSERT INTO "collection" (
			key, "sourceConnectionKey", revision, name, deleted, "sortOrder",
			"parentCollection", "createdAt", "updatedAt"
		) VALUES
			('EDGE0001', 'edge', 1, NULL, 0, 1, NULL, now(), now()),
			('EDGE0002', 'edge', 1, ' Aardvark', 0, 1, NULL, now(), now()),
			('EDGE0003', 'edge', 1, ' Apple', 0, 1, NULL, now(), now()),
			('EDGE0004', 'edge', 1, 'Beta', 0, 1, NULL, now(), now())
	`);
	await client.query(`
		CREATE INDEX fixture_collection_tree_idx
		ON "collection" ("sourceConnectionKey", "parentCollection", "sortOrder", key)
	`);
	await client.query(`
		CREATE INDEX fixture_collection_name_search_idx
		ON "collection" USING gin (lower(coalesce(name, '')) gin_trgm_ops)
	`);
}

async function verify() {
	const client = new Client({ connectionString: databaseUrl });
	await client.connect();
	const database = drizzle(client) as unknown as Database;
	try {
		await client.query("BEGIN");
		await createFixture(client);
		const queryStartedAt = performance.now();
		const first = await getAdminCollectionChildrenPage(database, {
			pageSize: 100,
			parentCollection: null,
			sourceConnectionKey: "native",
		});
		assert(first.items.length === 100, "First root page must contain 100 rows");
		assert(first.hasMore && first.nextCursor, "First root page must continue");
		assert(
			first.items.every(
				(item) => item.parentCollection === null && !item.deleted,
			),
			"Root browsing returned a child or deleted collection",
		);
		assert(
			first.items.every((item) => item.hasChildren),
			"Fixture roots should report children without loading them",
		);

		const second = await getAdminCollectionChildrenPage(database, {
			cursor: first.nextCursor,
			pageSize: 100,
			parentCollection: null,
			sourceConnectionKey: "native",
		});
		assert(second.items.length === 100, "Second root page must contain 100 rows");
		assert(
			!second.items.some(({ key }) => first.items.some((item) => item.key === key)),
			"Cursor pagination returned duplicate roots",
		);
		assert(
			first.items.at(-1)!.sortOrder! < second.items[0]!.sortOrder!,
			"Root pages are not ordered by collection order",
		);

		const edgeChildren: string[] = [];
		let edgeChildCursor: string | null = null;
		do {
			const page = await getAdminCollectionChildrenPage(database, {
				cursor: edgeChildCursor,
				pageSize: 1,
				parentCollection: null,
				sourceConnectionKey: "edge",
			});
			edgeChildren.push(...page.items.map(({ key }) => key));
			edgeChildCursor = page.nextCursor;
		} while (edgeChildCursor);
		assert(
			edgeChildren.join(",") === "EDGE0001,EDGE0002,EDGE0003,EDGE0004",
			"Child cursor skipped a null or whitespace-prefixed name",
		);

		const searchFirst = await searchAdminCollections(database, {
			pageSize: 25,
			query: "shared collection",
		});
		assert(searchFirst.items.length === 25, "Search must honor its page size");
		assert(
			searchFirst.hasMore && searchFirst.nextCursor,
			"Shared-name search must continue",
		);
		assert(
			searchFirst.items.every(({ name }) => name === "Shared collection"),
			"Search returned an unrelated collection",
		);
		assert(
			searchFirst.items.some(({ ancestors }) => ancestors.length > 0),
			"Search results must include breadcrumbs for nested collections",
		);
		const searchSecond = await searchAdminCollections(database, {
			cursor: searchFirst.nextCursor,
			pageSize: 25,
			query: "shared collection",
		});
		assert(searchSecond.items.length === 25, "Search second page is incomplete");
		assert(
			!searchSecond.items.some(({ key }) =>
				searchFirst.items.some((item) => item.key === key),
			),
			"Search cursor returned duplicate collections",
		);
		const edgeSearch: string[] = [];
		let edgeSearchCursor: string | null = null;
		do {
			const page = await searchAdminCollections(database, {
				cursor: edgeSearchCursor,
				pageSize: 1,
				query: "a",
				sourceConnectionKey: "edge",
			});
			edgeSearch.push(...page.items.map(({ key }) => key));
			edgeSearchCursor = page.nextCursor;
		} while (edgeSearchCursor);
		assert(
			edgeSearch.join(",") === "EDGE0002,EDGE0003,EDGE0004",
			"Search cursor skipped a whitespace-prefixed name",
		);

		const resolved = await resolveAdminCollections(database, [
			"C0000001",
			"C0010001",
			"C0000997",
		]);
		assert(resolved.length === 3, "Selected-key resolution omitted a collection");
		assert(
			resolved.map(({ key }) => key).join(",") ===
				"C0000001,C0010001,C0000997",
			"Selected-key resolution did not preserve requested order",
		);
		assert(resolved[1]!.ancestors.length === 1, "Nested selection lacks its path");
		assert(resolved[2]!.deleted, "Deleted selections must remain resolvable");
		const searchPlan = await client.query<{ "QUERY PLAN": unknown }>(
			`EXPLAIN (FORMAT JSON)
			 SELECT key FROM "collection"
			 WHERE lower(coalesce(name, '')) ILIKE $1`,
			["%shared collection%"],
		);
		assert(
			JSON.stringify(searchPlan.rows[0]?.["QUERY PLAN"]).includes(
				"fixture_collection_name_search_idx",
			),
			"Collection search did not use the trigram index",
		);
		const queryDurationMs = Math.round(performance.now() - queryStartedAt);
		assert(
			queryDurationMs < 2_500,
			`Collection catalogue queries took ${queryDurationMs}ms`,
		);

		await client.query("ROLLBACK");
		console.log(
			JSON.stringify({
				collections: COLLECTION_COUNT,
				queryDurationMs,
				rootPagesChecked: 6,
				resolvedSelections: resolved.length,
				searchIndex: "gin_trgm",
				searchPagesChecked: 2,
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
