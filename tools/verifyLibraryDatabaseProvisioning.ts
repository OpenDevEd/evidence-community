import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { quotePostgresIdentifier } from "../src/lib/deployment/library-database";
import { provisionLibraryDatabase } from "./provisionLibraryDatabase";

const { Client, Pool } = pg;

const configuredAdminUrl = process.env.EVIDENCE_LIBRARY_ADMIN_DATABASE_URL;
if (!configuredAdminUrl) {
	throw new Error("EVIDENCE_LIBRARY_ADMIN_DATABASE_URL is required.");
}
const adminUrl = new URL(configuredAdminUrl);
const adminUser = decodeURIComponent(adminUrl.username);
const runtimeHost = adminUrl.host;
const suffix = `${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
const libraries = [
	{
		database: `el_verify_amber_${suffix}`,
		password: `amber-${randomBytes(18).toString("base64url")}`,
		user: `el_verify_amber_user_${suffix}`,
	},
	{
		database: `el_verify_indigo_${suffix}`,
		password: `indigo-${randomBytes(18).toString("base64url")}`,
		user: `el_verify_indigo_user_${suffix}`,
	},
] as const;

async function migrateAndReadOwnDatabase(
	databaseUrl: string,
	expectedOwner: string,
) {
	const pool = new Pool({ connectionString: databaseUrl, max: 1 });
	try {
		await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
		const result = await pool.query<{ count: string }>(
			`SELECT COUNT(*)::text AS count FROM "status"`,
		);
		assert.equal(result.rows[0]?.count, "1");
		const extensions = await pool.query<{ extname: string; owner: string }>(
			`SELECT extension.extname, role.rolname AS owner
			 FROM pg_extension AS extension
			 JOIN pg_roles AS role ON role.oid = extension.extowner
			 WHERE extension.extname = ANY($1::text[])
			 ORDER BY extension.extname`,
			[["pg_trgm", "vector"]],
		);
		assert.deepEqual(extensions.rows, [
			{ extname: "pg_trgm", owner: adminUser },
			{ extname: "vector", owner: adminUser },
		]);
		const relationOwners = await pool.query<{ owner: string }>(
			`SELECT DISTINCT tableowner AS owner
			 FROM pg_tables
			 WHERE schemaname IN ('public', 'drizzle')
			 ORDER BY tableowner`,
		);
		assert.deepEqual(relationOwners.rows, [{ owner: expectedOwner }]);
	} finally {
		await pool.end();
	}
}

async function expectCrossDatabaseDenied(
	sourceUrl: string,
	targetDatabase: string,
) {
	const url = new URL(sourceUrl);
	url.pathname = `/${targetDatabase}`;
	const client = new Client({
		connectionString: url.toString(),
		connectionTimeoutMillis: 5_000,
	});
	await assert.rejects(
		async () => {
			try {
				await client.connect();
			} finally {
				await client.end().catch(() => undefined);
			}
		},
		(error: unknown) =>
			error instanceof Error &&
			/error|denied|permission|not permitted/i.test(error.message),
		`Expected ${url.username} to be denied access to ${targetDatabase}`,
	);
}

async function readAdminRights() {
	const client = new Client({ connectionString: adminUrl.toString() });
	await client.connect();
	try {
		const result = await client.query(
			`SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
			 FROM pg_roles WHERE rolname = $1`,
			[adminUser],
		);
		return result.rows;
	} finally {
		await client.end();
	}
}

async function cleanup() {
	const client = new Client({ connectionString: adminUrl.toString() });
	await client.connect();
	try {
		for (const library of libraries) {
			await client.query(
				`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
				[library.database],
			);
			await client.query(
				`DROP DATABASE IF EXISTS ${quotePostgresIdentifier(library.database)}`,
			);
		}
		for (const library of libraries) {
			await client.query(
				`DROP ROLE IF EXISTS ${quotePostgresIdentifier(library.user)}`,
			);
		}
	} finally {
		await client.end();
	}
}

async function main() {
	const results: Awaited<ReturnType<typeof provisionLibraryDatabase>>[] = [];
	try {
		const beforeAdmin = await readAdminRights();
		await assert.rejects(
			provisionLibraryDatabase({
				adminUrl: adminUrl.toString(),
				database: `el_verify_guard_${suffix}`,
				password: randomBytes(18).toString("base64url"),
				runtimeHost,
				user: adminUser,
			}),
			/protected/i,
		);
		assert.deepEqual(await readAdminRights(), beforeAdmin);

		for (const library of libraries) {
			const result = await provisionLibraryDatabase({
				adminUrl: adminUrl.toString(),
				database: library.database,
				password: library.password,
				runtimeHost,
				user: library.user,
			});
			assert.equal(result.action, "create");
			results.push(result);
			await migrateAndReadOwnDatabase(result.databaseUrl, library.user);
		}

		await expectCrossDatabaseDenied(
			results[0].databaseUrl,
			libraries[1].database,
		);
		await expectCrossDatabaseDenied(
			results[1].databaseUrl,
			libraries[0].database,
		);

		for (const [index, library] of libraries.entries()) {
			const repeated = await provisionLibraryDatabase({
				adminUrl: adminUrl.toString(),
				database: library.database,
				password: library.password,
				runtimeHost,
				user: library.user,
			});
			assert.equal(repeated.action, "normalize");
			assert.equal(repeated.databaseUrl, results[index].databaseUrl);
			await migrateAndReadOwnDatabase(repeated.databaseUrl, library.user);
		}

		console.log(
			JSON.stringify({
				crossDatabaseAccess: "denied",
				administratorGuard: "passed",
				databases: libraries.map((library) => library.database),
				migrations: "passed",
				rerun: "safe",
			}),
		);
	} finally {
		await cleanup();
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
