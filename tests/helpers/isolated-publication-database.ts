import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import type { Database } from "../../src/db/database-schema";
import { createPostgresDatabaseResource } from "../../src/db/postgres";

/** Run against a fresh migrated database and remove it even when an assertion fails. */
export async function withIsolatedPublicationDatabase(
	verify: (database: Database, client: Client) => Promise<void>,
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
			const resource = createPostgresDatabaseResource(temporaryUrl.toString());
			const client = new Client({ connectionString: temporaryUrl.toString() });
			try {
				await migrate(resource.database, { migrationsFolder: "drizzle" });
				await client.connect();
				await verify(resource.database, client);
			} finally {
				await Promise.all([client.end(), resource.dispose()]);
			}
		} finally {
			await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
		}
	} finally {
		await admin.end();
	}
}
