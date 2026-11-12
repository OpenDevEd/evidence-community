import { sql } from "drizzle-orm";
import { expect, it } from "vitest";

import { ADMIN_LIVE_CHANNEL, ADMIN_LIVE_TABLES, ADMIN_LIVE_UNWATCHED } from "@/lib/admin/live-contract";

import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

it("has every table either tell the admin about its changes or be listed as one the admin doesn't show", async () => {
	await withIsolatedPublicationDatabase(async (_database, client) => {
		const names = async (query: string) => (await client.query<{ name: string }>(query)).rows.map(({ name }) => name);
		const tables = await names(
			`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`,
		);
		// A table is watched only with all three triggers: one that misses deletes would leave removed rows on screen.
		const watched = await names(
			`SELECT c.relname AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
			 WHERE t.tgname IN ('admin_changed_insert', 'admin_changed_update', 'admin_changed_delete')
			 GROUP BY c.relname HAVING count(*) = 3 ORDER BY 1`,
		);
		expect(watched).toEqual(Object.keys(ADMIN_LIVE_TABLES).sort());
		expect(tables.filter((table) => !watched.includes(table))).toEqual([...ADMIN_LIVE_UNWATCHED].sort());
	});
});

it("tells of a watched table once per commit, and of nothing for a statement that changed no rows", async () => {
	await withIsolatedPublicationDatabase(async (database, client) => {
		const heard: string[] = [];
		client.on("notification", ({ payload }) => heard.push(payload ?? ""));
		await client.query(`LISTEN ${ADMIN_LIVE_CHANNEL}`);
		// A round trip on the listening connection delivers what was committed before it.
		const heardSoFar = async () => {
			await client.query("SELECT 1");
			return heard.splice(0);
		};

		await database.transaction(async (transaction) => {
			await transaction.execute(sql`INSERT INTO "tag" ("name") VALUES ('first')`);
			await transaction.execute(sql`INSERT INTO "tag" ("name") VALUES ('second')`);
		});
		expect(await heardSoFar()).toEqual(["tag"]);

		await database.execute(sql`UPDATE "tag" SET "name" = "name" WHERE false`);
		await database.execute(sql`DELETE FROM "tag" WHERE "name" = 'nobody'`);
		expect(await heardSoFar()).toEqual([]);

		await database.execute(sql`DELETE FROM "tag" WHERE "name" = 'first'`);
		expect(await heardSoFar()).toEqual(["tag"]);

		// A worker's own bookkeeping, which the admin doesn't show.
		await database.execute(sql`INSERT INTO "computedCache" ("key", "value", "computedAt") VALUES ('k', '{}'::jsonb, now())`);
		expect(await heardSoFar()).toEqual([]);
	});
});
