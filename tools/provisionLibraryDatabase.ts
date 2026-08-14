import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import pg from "pg";

import {
	buildLibraryDatabaseUrl,
	decideLibraryDatabaseAction,
	parseLibraryDatabaseName,
	quotePostgresIdentifier,
	validateLibraryDatabaseTarget,
} from "../src/lib/deployment/library-database";

const { Client, escapeIdentifier, escapeLiteral } = pg;

export type ProvisionLibraryDatabaseInput = {
	adminUrl: string;
	database: string;
	password: string;
	runtimeHost: string;
	user: string;
};

export async function provisionLibraryDatabase(
	input: ProvisionLibraryDatabaseInput,
) {
	const database = parseLibraryDatabaseName(input.database, "Database name");
	const user = parseLibraryDatabaseName(input.user, "Login name");
	if (!input.password.trim()) throw new Error("Login password is required.");
	const databaseUrl = buildLibraryDatabaseUrl({
		database,
		host: input.runtimeHost,
		password: input.password,
		user,
	});

	const adminUrl = new URL(input.adminUrl);
	if (
		adminUrl.protocol !== "postgres:" &&
		adminUrl.protocol !== "postgresql:"
	) {
		throw new Error("Administrator URL must be a PostgreSQL URL.");
	}
	const adminUser = decodeURIComponent(adminUrl.username);
	if (!adminUser)
		throw new Error("Administrator URL must include a login name.");

	const client = new Client({ connectionString: adminUrl.toString() });
	const lockName = `evidence-library-database:${database}`;
	await client.connect();
	try {
		await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
			lockName,
		]);
		try {
			const existingRoleResult = await client.query<{
				can_bypass_rls: boolean;
				can_create_database: boolean;
				can_create_role: boolean;
				can_replicate: boolean;
				is_superuser: boolean;
			}>(
				`SELECT
				   rolsuper AS is_superuser,
				   rolcreatedb AS can_create_database,
				   rolcreaterole AS can_create_role,
				   rolreplication AS can_replicate,
				   rolbypassrls AS can_bypass_rls
				 FROM pg_roles
				 WHERE rolname = $1`,
				[user],
			);
			const existingRole = existingRoleResult.rows[0];
			validateLibraryDatabaseTarget({
				adminUser,
				database,
				existingRole: existingRole
					? {
							canBypassRls: existingRole.can_bypass_rls,
							canCreateDatabase: existingRole.can_create_database,
							canCreateRole: existingRole.can_create_role,
							canReplicate: existingRole.can_replicate,
							isSuperuser: existingRole.is_superuser,
						}
					: null,
				user,
			});

			const existingDatabase = await client.query<{ owner: string }>(
				`SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1`,
				[database],
			);
			const existingOwner = existingDatabase.rows[0]?.owner ?? null;
			const action = decideLibraryDatabaseAction({
				existingOwner,
				requestedOwner: user,
			});

			const otherOwnedDatabases = await client.query<{ datname: string }>(
				`SELECT database.datname
				 FROM pg_database AS database
				 JOIN pg_roles AS role ON role.oid = database.datdba
				 WHERE role.rolname = $1 AND database.datname <> $2
				 ORDER BY database.datname`,
				[user, database],
			);
			if (otherOwnedDatabases.rows.length > 0) {
				throw new Error(
					`The login ${user} already owns another database: ${otherOwnedDatabases.rows.map((row) => row.datname).join(", ")}.`,
				);
			}

			await client.query(
				`DO $provision$
				 BEGIN
				   IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${escapeLiteral(user)}) THEN
				     CREATE ROLE ${quotePostgresIdentifier(user)};
				   END IF;
				 END
				 $provision$`,
			);
			await client.query(
				`ALTER ROLE ${quotePostgresIdentifier(user)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${escapeLiteral(input.password)}`,
			);

			const memberships = await client.query<{ role_name: string }>(
				`SELECT parent.rolname AS role_name
				 FROM pg_auth_members AS membership
				 JOIN pg_roles AS member ON member.oid = membership.member
				 JOIN pg_roles AS parent ON parent.oid = membership.roleid
				 WHERE member.rolname = $1`,
				[user],
			);
			for (const membership of memberships.rows) {
				await client.query(
					`REVOKE ${escapeIdentifier(membership.role_name)} FROM ${quotePostgresIdentifier(user)}`,
				);
			}

			if (action === "create") {
				await client.query(
					`CREATE DATABASE ${quotePostgresIdentifier(database)} OWNER ${quotePostgresIdentifier(user)}`,
				);
			}

			const targetAdminUrl = new URL(adminUrl);
			targetAdminUrl.pathname = `/${database}`;
			const targetClient = new Client({
				connectionString: targetAdminUrl.toString(),
			});
			await targetClient.connect();
			try {
				await targetClient.query(
					"CREATE EXTENSION IF NOT EXISTS vector",
				);
				await targetClient.query(
					"CREATE EXTENSION IF NOT EXISTS pg_trgm",
				);
				const extensions = await targetClient.query<{
					extname: string;
				}>(
					`SELECT extname FROM pg_extension WHERE extname = ANY($1::text[]) ORDER BY extname`,
					[["pg_trgm", "vector"]],
				);
				if (
					extensions.rows.map((row) => row.extname).join(",") !==
					"pg_trgm,vector"
				) {
					throw new Error(
						"PostgreSQL did not install the required pg_trgm and vector extensions.",
					);
				}
			} finally {
				await targetClient.end();
			}

			const explicitGrantees = await client.query<{ role_name: string }>(
				`SELECT DISTINCT grantee.rolname AS role_name
				 FROM pg_database AS database
				 CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) AS acl
				 JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
				 WHERE database.datname = $1
				   AND grantee.rolname <> $2`,
				[database, user],
			);
			for (const grantee of explicitGrantees.rows) {
				await client.query(
					`REVOKE ALL PRIVILEGES ON DATABASE ${quotePostgresIdentifier(database)} FROM ${escapeIdentifier(grantee.role_name)}`,
				);
			}

			await client.query(
				`REVOKE ALL PRIVILEGES ON DATABASE ${quotePostgresIdentifier(database)} FROM PUBLIC`,
			);
			await client.query(
				`GRANT CONNECT, CREATE, TEMPORARY ON DATABASE ${quotePostgresIdentifier(database)} TO ${quotePostgresIdentifier(user)}`,
			);

			const verified = await client.query<{
				can_bypass_rls: boolean;
				can_create_database: boolean;
				can_create_role: boolean;
				can_login: boolean;
				can_replicate: boolean;
				is_superuser: boolean;
				owner: string;
			}>(
				`SELECT
				   pg_get_userbyid(database.datdba) AS owner,
				   role.rolcanlogin AS can_login,
				   role.rolsuper AS is_superuser,
				   role.rolcreatedb AS can_create_database,
				   role.rolcreaterole AS can_create_role,
				   role.rolreplication AS can_replicate,
				   role.rolbypassrls AS can_bypass_rls
				 FROM pg_database AS database
				 JOIN pg_roles AS role ON role.rolname = $2
				 WHERE database.datname = $1`,
				[database, user],
			);
			const row = verified.rows[0];
			if (
				!row ||
				row.owner !== user ||
				!row.can_login ||
				row.is_superuser ||
				row.can_create_database ||
				row.can_create_role ||
				row.can_replicate ||
				row.can_bypass_rls
			) {
				throw new Error(
					"PostgreSQL did not accept the requested library access rules.",
				);
			}

			return { action, database, databaseUrl, user };
		} finally {
			await client.query(
				"SELECT pg_advisory_unlock(hashtextextended($1, 0))",
				[lockName],
			);
		}
	} finally {
		await client.end();
	}
}

function parseCommandLine() {
	const { values } = parseArgs({
		allowPositionals: false,
		options: {
			"admin-url": { type: "string" },
			database: { type: "string" },
			password: { type: "string" },
			"runtime-host": { type: "string" },
			user: { type: "string" },
		},
		strict: true,
	});
	if (
		!values["admin-url"] ||
		!values.database ||
		!values.password ||
		!values["runtime-host"] ||
		!values.user
	) {
		throw new Error(
			"Usage: npm run database:provision -- --admin-url <url> --database <name> --user <name> --password <password> --runtime-host <host[:port]>",
		);
	}
	return {
		adminUrl: values["admin-url"],
		database: values.database,
		password: values.password,
		runtimeHost: values["runtime-host"],
		user: values.user,
	};
}

async function main() {
	const result = await provisionLibraryDatabase(parseCommandLine());
	console.log(JSON.stringify(result));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
