import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import type { Database } from "../src/db/database-schema";
import {
	getAdminCollectionChildrenPage,
	listOpenScholarCollections,
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
	await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
	await client.query(`
		CREATE TEMP TABLE "sourceConnection" (
			key varchar(64) PRIMARY KEY,
			"displayName" text,
			provider text NOT NULL,
			"externalScopeKey" text
		) ON COMMIT DROP;
		INSERT INTO "sourceConnection" (key, "displayName", provider, "externalScopeKey") VALUES
			('native', NULL, 'native', NULL),
			('edge', 'Configuration test source', 'zotero', '11'),
			('os', 'Configuration test source', 'zotero', '22');
	`);
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
				-- Record keys never contain 0 or 1, so spell them A and B.
				'C' || translate(lpad(value::text, 7, '0'), '01', 'AB'),
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
					ELSE 'C' || translate(lpad((((value - 10001) % 10000) + 1)::text, 7, '0'), '01', 'AB')
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
			('EDGEAAAA', 'edge', 1, NULL, 0, 1, NULL, now(), now()),
			('EDGEAAAB', 'edge', 1, ' Aardvark', 0, 1, NULL, now(), now()),
			('EDGEAAAC', 'edge', 1, ' Apple', 0, 1, NULL, now(), now()),
			('EDGEAAAD', 'edge', 1, 'Beta', 0, 1, NULL, now(), now()),
			('PARENTAA', 'os', 1, 'Parent with a live child', 0, 1, NULL, now(), now()),
			('CHILDAAA', 'os', 1, 'Live child', 0, 1, 'PARENTAA', now(), now()),
			('DELPARAA', 'os', 1, 'Parent with a deleted child', 0, 2, NULL, now(), now()),
			('DELCHAAA', 'os', 1, 'Deleted child', 1, 1, 'DELPARAA', now(), now()),
			('LEAFAAAA', 'os', 1, 'Leaf', 0, 3, NULL, now(), now())
	`);
	await client.query(`
		CREATE INDEX fixture_collection_tree_idx
		ON "collection" ("sourceConnectionKey", "parentCollection", "sortOrder", key)
	`);
	await client.query(`
		CREATE INDEX fixture_collection_name_search_idx
		ON "collection" USING gin (lower(coalesce(name, '')) gin_trgm_ops)
	`);
	await client.query(`
		CREATE INDEX fixture_collection_source_state_search_idx
		ON "collection" (
			"sourceConnectionKey",
			deleted,
			lower(coalesce(name, '')),
			key
		)
	`);
	await client.query(`
		CREATE TEMP TABLE "item" (key varchar(8) PRIMARY KEY, deleted integer, "parentItem" varchar(8)) ON COMMIT DROP;
		CREATE TEMP TABLE "itemToCollection" ("itemKey" varchar(8), "collectionKey" varchar(8)) ON COMMIT DROP;
		INSERT INTO "item" VALUES ('RECORD22', 0, NULL);
		INSERT INTO "itemToCollection" VALUES ('RECORD22', 'PARENTAA'), ('RECORD22', 'CHILDAAA');
	`);
	await client.query(`ANALYZE "collection"`);
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
			edgeChildren.join(",") === "EDGEAAAA,EDGEAAAB,EDGEAAAC,EDGEAAAD",
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
		const deletedSearch = await searchAdminCollections(database, {
			pageSize: 25,
			query: "",
			sourceConnectionKey: "native",
			state: "deleted",
		});
		assert(deletedSearch.items.length > 0, "Deleted search returned no rows");
		assert(
			deletedSearch.items.every(({ deleted }) => deleted),
			"Deleted-only search returned an active collection",
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
			edgeSearch.join(",") === "EDGEAAAB,EDGEAAAC,EDGEAAAD",
			"Search cursor skipped a whitespace-prefixed name",
		);

		const resolved = await resolveAdminCollections(database, [
			"CAAAAAAB",
			"CAABAAAB",
			"CAAAA997",
		]);
		assert(resolved.length === 3, "Selected-key resolution omitted a collection");
		assert(
			resolved.map(({ key }) => key).join(",") ===
				"CAAAAAAB,CAABAAAB,CAAAA997",
			"Selected-key resolution did not preserve requested order",
		);
		assert(resolved[1]!.ancestors.length === 1, "Nested selection lacks its path");
		assert(resolved[2]!.deleted, "Deleted selections must remain resolvable");
		// OpenScholar hides collections without a live child, so the rows it
		// reads must say which ones have one.
		const openScholar = await listOpenScholarCollections(database, {
			ids: "PARENTAA,DELPARAA,LEAFAAAA",
		});
		assert(
			openScholar.items
				.map(({ id, hasChildren }) => `${id}:${hasChildren}`)
				.join(",") === "PARENTAA:true,DELPARAA:false,LEAFAAAA:false",
			"OpenScholar rows must report a live child and nothing else",
		);
		assert(
			openScholar.items.every(({ source }) => source.includes("Configuration test source")),
			"Collection results must use the saved source name",
		);
		assert(openScholar.items[0]?.count === 1, "Descendant counts must count each record once");
		const duplicateNames = await listOpenScholarCollections(database, { ids: "PARENTAA,EDGEAAAA" });
		assert(
			duplicateNames.items.length === 2 && new Set(duplicateNames.items.map(({ source }) => source)).size === 2,
			"Groups with the same display name must remain distinct source choices",
		);
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
		const deletedPlan = await client.query<{ "QUERY PLAN": unknown }>(
			`EXPLAIN (FORMAT JSON)
			 SELECT key FROM "collection"
			 WHERE "sourceConnectionKey" = 'native' AND deleted = 1
			 ORDER BY lower(coalesce(name, '')), "sourceConnectionKey", key
			 LIMIT 25`,
		);
		assert(
			JSON.stringify(deletedPlan.rows[0]?.["QUERY PLAN"]).includes(
				"fixture_collection_source_state_search_idx",
			),
			"Deleted collection browsing did not use the state search index",
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
