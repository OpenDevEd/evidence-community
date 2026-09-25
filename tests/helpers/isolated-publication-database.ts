import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import type { Database } from "../../src/db/database-schema";
import { createPostgresDatabaseResource } from "../../src/db/postgres";

async function waitForDatabaseConnectionsToClose(
	admin: Client,
	databaseName: string,
) {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const result = await admin.query<{ active: boolean }>(
			"SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = $1) AS active",
			[databaseName],
		);
		if (!result.rows[0]?.active) return;
		await delay(10);
	}
	throw new Error(`Database connections did not close for ${databaseName}`);
}

/** Run against a fresh migrated database and remove it even when an assertion fails. */
export async function withIsolatedPublicationDatabase(
	verify: (database: Database, client: Client) => Promise<void>,
	afterOutboxCommit?: Parameters<typeof createPostgresDatabaseResource>[1],
) {
	const source = process.env.DATABASE_URL_POST;
	if (!source) throw new Error("DATABASE_URL_POST is required");
	const databaseName = `publication_test_${randomUUID().replaceAll("-", "")}`;
	const adminUrl = new URL(source);
	adminUrl.pathname = "/postgres";
	const temporaryUrl = new URL(source);
	temporaryUrl.pathname = `/${databaseName}`;
	const admin = new Client({ connectionString: adminUrl.toString() });
	await admin.connect();
	try {
		await admin.query(`CREATE DATABASE "${databaseName}"`);
		try {
			const resource = createPostgresDatabaseResource(temporaryUrl.toString(), afterOutboxCommit);
			const client = new Client({ connectionString: temporaryUrl.toString() });
			try {
				await migrate(resource.database, { migrationsFolder: "drizzle" });
				await client.connect();
				await verify(resource.database, client);
			} finally {
				await Promise.all([client.end(), resource.dispose()]);
			}
		} finally {
			await waitForDatabaseConnectionsToClose(admin, databaseName);
			await admin.query(`DROP DATABASE "${databaseName}"`);
		}
	} finally {
		await admin.end();
	}
}
