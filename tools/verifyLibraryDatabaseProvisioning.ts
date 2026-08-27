import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import pg from "pg";

import {
	deriveLibraryDatabaseNames,
	LibraryDatabaseProvisioningError,
	quotePostgresIdentifier,
} from "../src/lib/deployment/library-database";
import {
	deleteOpenScholarLibraryDatabase,
	reconcileLibraryDatabase,
	reconcileOpenScholarLibraryDatabase,
} from "../src/lib/deployment/provision-library-database";

const { Client, Pool, escapeLiteral } = pg;
const configuredAdminUrl = process.env.EVIDENCE_LIBRARY_ADMIN_DATABASE_URL;
if (!configuredAdminUrl) {
	throw new Error("EVIDENCE_LIBRARY_ADMIN_DATABASE_URL is required.");
}
const adminUrl = new URL(configuredAdminUrl);
const adminUser = decodeURIComponent(adminUrl.username);
const runtimeHost =
	process.env.EVIDENCE_LIBRARY_DATABASE_RUNTIME_HOST ?? adminUrl.host;
const suffix = `${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;

function libraryFixture(name: string) {
	const libraryId = `database-verifier-${name}-${suffix}`;
	return {
		...deriveLibraryDatabaseNames(libraryId),
		libraryId,
		password: `${name}-${randomBytes(18).toString("base64url")}`,
	};
}

const libraries = [libraryFixture("amber"), libraryFixture("indigo")];
const conflict = libraryFixture("conflict");

function adminReachableLibraryUrl(library: (typeof libraries)[number]) {
	const url = new URL(adminUrl);
	url.username = library.loginName;
	url.password = library.password;
	url.pathname = `/${library.databaseName}`;
	return url.toString();
}

async function reconcileLibrary(library: (typeof libraries)[number]) {
	return reconcileOpenScholarLibraryDatabase({
		adminUrl: adminUrl.toString(),
		libraryId: library.libraryId,
		password: library.password,
		runtimeHost,
	});
}

async function readOwnDatabase(library: (typeof libraries)[number]) {
	const pool = new Pool({
		connectionString: adminReachableLibraryUrl(library),
		max: 1,
	});
	try {
		const status = await pool.query<{ count: string }>(
			`SELECT COUNT(*)::text AS count FROM "status"`,
		);
		assert.equal(status.rows[0]?.count, "1");
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
		assert.deepEqual(relationOwners.rows, [{ owner: library.loginName }]);
	} finally {
		await pool.end();
	}
}

async function expectCrossDatabaseDenied(
	source: (typeof libraries)[number],
	targetDatabaseName: string,
) {
	const url = new URL(adminReachableLibraryUrl(source));
	url.pathname = `/${targetDatabaseName}`;
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
		`Expected ${source.loginName} to be denied access to ${targetDatabaseName}`,
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

async function withAdminClient(
	run: (client: InstanceType<typeof Client>) => Promise<void>,
) {
	const client = new Client({ connectionString: adminUrl.toString() });
	await client.connect();
	try {
		await run(client);
	} finally {
		await client.end();
	}
}

async function cleanup() {
	await withAdminClient(async (client) => {
		for (const databaseName of [
			...libraries.map((library) => library.databaseName),
			conflict.databaseName,
		]) {
			await client.query(
				`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
				[databaseName],
			);
			await client.query(
				`DROP DATABASE IF EXISTS ${quotePostgresIdentifier(databaseName)}`,
			);
		}
		for (const loginName of [
			...libraries.map((library) => library.loginName),
			conflict.loginName,
		]) {
			await client.query(
				`DROP ROLE IF EXISTS ${quotePostgresIdentifier(loginName)}`,
			);
		}
	});
}

async function readLibraryResourceState(library: (typeof libraries)[number]) {
	const client = new Client({ connectionString: adminUrl.toString() });
	await client.connect();
	try {
		const result = await client.query<{
			database_exists: boolean;
			login_exists: boolean;
		}>(
			`SELECT
			   EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS database_exists,
			   EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $2) AS login_exists`,
			[library.databaseName, library.loginName],
		);
		return result.rows[0];
	} finally {
		await client.end();
	}
}

async function main() {
	try {
		const beforeAdmin = await readAdminRights();
		await assert.rejects(
			reconcileLibraryDatabase({
				adminUrl: adminUrl.toString(),
				databaseName: `el_verify_guard_${suffix}`,
				loginName: adminUser,
				password: randomBytes(18).toString("base64url"),
				runtimeHost,
			}),
			(error: unknown) =>
				error instanceof LibraryDatabaseProvisioningError &&
				error.code === "login_security_conflict",
		);
		assert.deepEqual(await readAdminRights(), beforeAdmin);

		for (const library of libraries) {
			const result = await reconcileLibrary(library);
			assert.equal(result.outcome, "created");
			assert.equal(result.databaseName, library.databaseName);
			assert.equal(result.loginName, library.loginName);
			const runtimeUrl = new URL(result.databaseUrl);
			assert.equal(runtimeUrl.host, runtimeHost);
			assert.equal(runtimeUrl.pathname, `/${library.databaseName}`);
			await readOwnDatabase(library);
		}

		for (const library of libraries) {
			const repeated = await reconcileLibrary(library);
			assert.equal(repeated.outcome, "matched");
			assert.equal(repeated.databaseName, library.databaseName);
			assert.equal(repeated.loginName, library.loginName);
			await readOwnDatabase(library);
		}

		await expectCrossDatabaseDenied(
			libraries[0],
			libraries[1].databaseName,
		);
		await expectCrossDatabaseDenied(
			libraries[1],
			libraries[0].databaseName,
		);

		await withAdminClient(async (client) => {
			await client.query(
				`ALTER ROLE ${quotePostgresIdentifier(libraries[0].loginName)} PASSWORD ${escapeLiteral(`changed-${randomBytes(12).toString("base64url")}`)}`,
			);
			await client.query(
				`GRANT CONNECT ON DATABASE ${quotePostgresIdentifier(libraries[0].databaseName)} TO PUBLIC`,
			);
		});
		const repaired = await reconcileLibrary(libraries[0]);
		assert.equal(repaired.outcome, "updated");
		await readOwnDatabase(libraries[0]);

		await withAdminClient(async (client) => {
			await client.query(
				`CREATE DATABASE ${quotePostgresIdentifier(conflict.databaseName)} OWNER ${quotePostgresIdentifier(adminUser)}`,
			);
		});
		await assert.rejects(
			reconcileOpenScholarLibraryDatabase({
				adminUrl: adminUrl.toString(),
				libraryId: conflict.libraryId,
				password: conflict.password,
				runtimeHost,
			}),
			(error: unknown) =>
				error instanceof LibraryDatabaseProvisioningError &&
				error.code === "database_owner_conflict",
		);

		for (const library of libraries) {
			const deleted = await deleteOpenScholarLibraryDatabase({
				adminUrl: adminUrl.toString(),
				libraryId: library.libraryId,
			});
			assert.equal(deleted.outcome, "deleted");
			assert.equal(deleted.databaseName, library.databaseName);
			assert.equal(deleted.loginName, library.loginName);
			assert.deepEqual(await readLibraryResourceState(library), {
				database_exists: false,
				login_exists: false,
			});
			const repeated = await deleteOpenScholarLibraryDatabase({
				adminUrl: adminUrl.toString(),
				libraryId: library.libraryId,
			});
			assert.equal(repeated.outcome, "absent");
		}

		console.log(
			JSON.stringify({
				administratorGuard: "passed",
				conflictingOwner: "rejected",
				crossDatabaseAccess: "denied",
				databases: libraries.map((library) => library.databaseName),
				migrations: "passed inside reconciliation",
				outcomes: ["created", "matched", "updated"],
				teardown: ["deleted", "absent"],
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
