import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";

import {
	buildLibraryDatabaseUrl,
	decideLibraryDatabaseAction,
	deriveLibraryDatabaseNames,
	LibraryDatabaseProvisioningError,
	parseLibraryDatabaseName,
	parseLibraryDatabasePassword,
	parsePostgresAdminUrl,
	quotePostgresIdentifier,
	validateLibraryDatabaseTarget,
	type ExistingLibraryRoleSecurity,
	type LibraryDatabaseAction,
	type LibraryDatabaseOutcome,
} from "./library-database";

const { Client, Pool, escapeIdentifier, escapeLiteral } = pg;
const migrationsFolder = fileURLToPath(
	new URL("../../../drizzle", import.meta.url),
);
const latestMigrationMillis = Math.max(
	...readMigrationFiles({ migrationsFolder }).map(
		(migration) => migration.folderMillis,
	),
);

type ExistingLibraryRole = ExistingLibraryRoleSecurity & {
	canInherit: boolean;
	canLogin: boolean;
};

type DatabaseAccessState = {
	canConnect: boolean;
	canCreate: boolean;
	canCreateTemporaryTables: boolean;
	hasUnwantedGrants: boolean;
};

type TargetDatabaseState = {
	extensionsMatch: boolean;
	migrationsMatch: boolean;
};

export type ReconcileLibraryDatabaseInput = {
	adminUrl: string;
	databaseName: string;
	loginName: string;
	password: string;
	runtimeHost: string;
};

export type ReconcileOpenScholarLibraryDatabaseInput = {
	adminUrl: string;
	libraryId: string;
	password: string;
	runtimeHost: string;
};

export type LibraryDatabaseReconciliationResult = {
	outcome: LibraryDatabaseOutcome;
	databaseName: string;
	loginName: string;
	databaseUrl: string;
};

type ResolvedReconciliationInput = {
	adminUrl: URL;
	adminUser: string;
	databaseName: string;
	databaseUrl: string;
	loginName: string;
	password: string;
};

type LockedReconciliationInput = ResolvedReconciliationInput & {
	client: InstanceType<typeof Client>;
};

function restrictedUrlThroughAdmin(input: {
	adminUrl: URL;
	databaseName: string;
	loginName: string;
	password: string;
}) {
	const url = new URL(input.adminUrl);
	url.username = input.loginName;
	url.password = input.password;
	url.pathname = `/${input.databaseName}`;
	return url.toString();
}

async function readExistingRole(
	client: InstanceType<typeof Client>,
	loginName: string,
): Promise<ExistingLibraryRole | null> {
	const result = await client.query<{
		can_bypass_rls: boolean;
		can_create_database: boolean;
		can_create_role: boolean;
		can_inherit: boolean;
		can_login: boolean;
		can_replicate: boolean;
		is_superuser: boolean;
	}>(
		`SELECT
		   rolsuper AS is_superuser,
		   rolcreatedb AS can_create_database,
		   rolcreaterole AS can_create_role,
		   rolinherit AS can_inherit,
		   rolcanlogin AS can_login,
		   rolreplication AS can_replicate,
		   rolbypassrls AS can_bypass_rls
		 FROM pg_roles
		 WHERE rolname = $1`,
		[loginName],
	);
	const role = result.rows[0];
	if (!role) return null;
	return {
		canBypassRls: role.can_bypass_rls,
		canCreateDatabase: role.can_create_database,
		canCreateRole: role.can_create_role,
		canInherit: role.can_inherit,
		canLogin: role.can_login,
		canReplicate: role.can_replicate,
		isSuperuser: role.is_superuser,
	};
}

async function readDatabaseOwner(
	client: InstanceType<typeof Client>,
	databaseName: string,
) {
	const result = await client.query<{ owner: string }>(
		"SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1",
		[databaseName],
	);
	return result.rows[0]?.owner ?? null;
}

async function readOwnedDatabaseNames(
	client: InstanceType<typeof Client>,
	loginName: string,
	databaseName: string,
) {
	const result = await client.query<{ datname: string }>(
		`SELECT database.datname
		 FROM pg_database AS database
		 JOIN pg_roles AS role ON role.oid = database.datdba
		 WHERE role.rolname = $1 AND database.datname <> $2
		 ORDER BY database.datname`,
		[loginName, databaseName],
	);
	return result.rows.map((row) => row.datname);
}

function assertOwnsNoOtherDatabase(
	loginName: string,
	ownedDatabaseNames: string[],
) {
	if (ownedDatabaseNames.length === 0) return;
	throw new LibraryDatabaseProvisioningError(
		"login_database_conflict",
		`The login ${loginName} already owns another database: ${ownedDatabaseNames.join(", ")}.`,
	);
}

async function readRoleMemberships(
	client: InstanceType<typeof Client>,
	loginName: string,
) {
	const result = await client.query<{ role_name: string }>(
		`SELECT parent.rolname AS role_name
		 FROM pg_auth_members AS membership
		 JOIN pg_roles AS member ON member.oid = membership.member
		 JOIN pg_roles AS parent ON parent.oid = membership.roleid
		 WHERE member.rolname = $1
		 ORDER BY parent.rolname`,
		[loginName],
	);
	return result.rows.map((row) => row.role_name);
}

async function readDatabaseAccessState(
	client: InstanceType<typeof Client>,
	databaseName: string,
	loginName: string,
): Promise<DatabaseAccessState> {
	const result = await client.query<{
		can_connect: boolean;
		can_create: boolean;
		can_create_temporary_tables: boolean;
		has_unwanted_grants: boolean;
	}>(
		`SELECT
		   has_database_privilege($2, database.datname, 'CONNECT') AS can_connect,
		   has_database_privilege($2, database.datname, 'CREATE') AS can_create,
		   has_database_privilege($2, database.datname, 'TEMPORARY') AS can_create_temporary_tables,
		   EXISTS (
		     SELECT 1
		     FROM aclexplode(
		       COALESCE(database.datacl, acldefault('d', database.datdba))
		     ) AS acl
		     WHERE acl.grantee <> database.datdba
		   ) AS has_unwanted_grants
		 FROM pg_database AS database
		 WHERE database.datname = $1`,
		[databaseName, loginName],
	);
	const state = result.rows[0];
	if (!state) {
		throw new LibraryDatabaseProvisioningError(
			"database_verification_failed",
			`PostgreSQL did not return the database ${databaseName}.`,
		);
	}
	return {
		canConnect: state.can_connect,
		canCreate: state.can_create,
		canCreateTemporaryTables: state.can_create_temporary_tables,
		hasUnwantedGrants: state.has_unwanted_grants,
	};
}

function accessStateMatches(state: DatabaseAccessState) {
	return (
		state.canConnect &&
		state.canCreate &&
		state.canCreateTemporaryTables &&
		!state.hasUnwantedGrants
	);
}

async function passwordMatches(input: {
	adminUrl: URL;
	databaseName: string;
	loginName: string;
	password: string;
}) {
	const client = new Client({
		connectionString: restrictedUrlThroughAdmin(input),
		connectionTimeoutMillis: 5_000,
	});
	try {
		await client.connect();
		return true;
	} catch (error: unknown) {
		const code =
			typeof error === "object" && error && "code" in error
				? String(error.code)
				: "";
		if (code === "28P01" || code === "28000") return false;
		throw error;
	} finally {
		await client.end().catch(() => undefined);
	}
}

async function readMigrationState(client: InstanceType<typeof Client>) {
	const table = await client.query<{ table_name: string | null }>(
		"SELECT to_regclass('drizzle.__drizzle_migrations')::text AS table_name",
	);
	if (!table.rows[0]?.table_name) return false;
	const latest = await client.query<{ created_at: string | null }>(
		`SELECT MAX(created_at)::text AS created_at
		 FROM drizzle.__drizzle_migrations`,
	);
	const createdAt = Number(latest.rows[0]?.created_at ?? Number.NaN);
	return Number.isFinite(createdAt) && createdAt >= latestMigrationMillis;
}

async function assertApplicationObjectOwners(
	client: InstanceType<typeof Client>,
	loginName: string,
) {
	const result = await client.query<{
		schemaname: string;
		tablename: string;
		tableowner: string;
	}>(
		`SELECT schemaname, tablename, tableowner
		 FROM pg_tables
		 WHERE schemaname IN ('public', 'drizzle')
		   AND tableowner <> $1
		 ORDER BY schemaname, tablename`,
		[loginName],
	);
	if (result.rows.length === 0) return;
	const first = result.rows[0];
	throw new LibraryDatabaseProvisioningError(
		"database_object_owner_conflict",
		`The table ${first.schemaname}.${first.tablename} is owned by ${first.tableowner}, not ${loginName}.`,
	);
}

async function readTargetDatabaseState(input: {
	adminUrl: URL;
	adminUser: string;
	databaseName: string;
	loginName: string;
}): Promise<TargetDatabaseState> {
	const targetAdminUrl = new URL(input.adminUrl);
	targetAdminUrl.pathname = `/${input.databaseName}`;
	const client = new Client({ connectionString: targetAdminUrl.toString() });
	await client.connect();
	try {
		const extensions = await client.query<{ extname: string; owner: string }>(
			`SELECT extension.extname, role.rolname AS owner
			 FROM pg_extension AS extension
			 JOIN pg_roles AS role ON role.oid = extension.extowner
			 WHERE extension.extname = ANY($1::text[])
			 ORDER BY extension.extname`,
			[["pg_trgm", "vector"]],
		);
		for (const extension of extensions.rows) {
			if (extension.owner !== input.adminUser) {
				throw new LibraryDatabaseProvisioningError(
					"extension_owner_conflict",
					`The ${extension.extname} extension is owned by ${extension.owner}, not ${input.adminUser}.`,
				);
			}
		}
		await assertApplicationObjectOwners(client, input.loginName);
		return {
			extensionsMatch:
				extensions.rows.map((extension) => extension.extname).join(",") ===
				"pg_trgm,vector",
			migrationsMatch: await readMigrationState(client),
		};
	} finally {
		await client.end();
	}
}

async function ensureRole(input: {
	client: InstanceType<typeof Client>;
	exists: boolean;
	loginName: string;
	password: string;
}) {
	if (!input.exists) {
		await input.client.query(
			`CREATE ROLE ${quotePostgresIdentifier(input.loginName)}`,
		);
	}
	await input.client.query(
		`ALTER ROLE ${quotePostgresIdentifier(input.loginName)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${escapeLiteral(input.password)}`,
	);
	for (const membership of await readRoleMemberships(
		input.client,
		input.loginName,
	)) {
		await input.client.query(
			`REVOKE ${escapeIdentifier(membership)} FROM ${quotePostgresIdentifier(input.loginName)}`,
		);
	}
}

async function ensureDatabaseAccess(input: {
	client: InstanceType<typeof Client>;
	databaseName: string;
	loginName: string;
}) {
	const grantees = await input.client.query<{ role_name: string }>(
		`SELECT DISTINCT pg_get_userbyid(acl.grantee) AS role_name
		 FROM pg_database AS database
		 CROSS JOIN LATERAL aclexplode(
		   COALESCE(database.datacl, acldefault('d', database.datdba))
		 ) AS acl
		 WHERE database.datname = $1
		   AND acl.grantee <> 0
		   AND acl.grantee <> database.datdba
		 ORDER BY role_name`,
		[input.databaseName],
	);
	for (const grantee of grantees.rows) {
		await input.client.query(
			`REVOKE ALL PRIVILEGES ON DATABASE ${quotePostgresIdentifier(input.databaseName)} FROM ${escapeIdentifier(grantee.role_name)}`,
		);
	}
	await input.client.query(
		`REVOKE ALL PRIVILEGES ON DATABASE ${quotePostgresIdentifier(input.databaseName)} FROM PUBLIC`,
	);
	await input.client.query(
		`GRANT CONNECT, CREATE, TEMPORARY ON DATABASE ${quotePostgresIdentifier(input.databaseName)} TO ${quotePostgresIdentifier(input.loginName)}`,
	);
}

async function ensureExtensions(input: {
	adminUrl: URL;
	databaseName: string;
}) {
	const targetAdminUrl = new URL(input.adminUrl);
	targetAdminUrl.pathname = `/${input.databaseName}`;
	const client = new Client({ connectionString: targetAdminUrl.toString() });
	await client.connect();
	try {
		await client.query("CREATE EXTENSION IF NOT EXISTS vector");
		await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
	} finally {
		await client.end();
	}
}

async function runMigrations(input: {
	adminUrl: URL;
	databaseName: string;
	loginName: string;
	password: string;
}) {
	const pool = new Pool({
		connectionString: restrictedUrlThroughAdmin(input),
		max: 1,
	});
	try {
		await migrate(drizzle(pool), { migrationsFolder });
	} finally {
		await pool.end();
	}
}

async function verifyReconciliation(input: {
	adminUrl: URL;
	adminUser: string;
	client: InstanceType<typeof Client>;
	databaseName: string;
	loginName: string;
	password: string;
}) {
	const role = await readExistingRole(input.client, input.loginName);
	validateLibraryDatabaseTarget({
		adminUser: input.adminUser,
		database: input.databaseName,
		existingRole: role,
		user: input.loginName,
	});
	const access = await readDatabaseAccessState(
		input.client,
		input.databaseName,
		input.loginName,
	);
	const target = await readTargetDatabaseState(input);
	const ownedDatabases = await readOwnedDatabaseNames(
		input.client,
		input.loginName,
		input.databaseName,
	);
	const matches = [
		role?.canLogin === true,
		role?.canInherit === false,
		(await readDatabaseOwner(input.client, input.databaseName)) ===
			input.loginName,
		(await readRoleMemberships(input.client, input.loginName)).length === 0,
		ownedDatabases.length === 0,
		accessStateMatches(access),
		target.extensionsMatch,
		target.migrationsMatch,
		await passwordMatches(input),
	].every(Boolean);
	if (!matches) {
		throw new LibraryDatabaseProvisioningError(
			"database_verification_failed",
			"PostgreSQL did not accept the requested library database rules.",
		);
	}
}

function resolveReconciliationInput(
	input: ReconcileLibraryDatabaseInput,
): ResolvedReconciliationInput {
	const databaseName = parseLibraryDatabaseName(
		input.databaseName,
		"Database name",
	);
	const loginName = parseLibraryDatabaseName(input.loginName, "Login name");
	const password = parseLibraryDatabasePassword(input.password);
	const adminUrl = parsePostgresAdminUrl(input.adminUrl);
	const adminUser = decodeURIComponent(adminUrl.username);
	const databaseUrl = buildLibraryDatabaseUrl({
		database: databaseName,
		host: input.runtimeHost,
		password,
		user: loginName,
	});
	return {
		adminUrl,
		adminUser,
		databaseName,
		databaseUrl,
		loginName,
		password,
	};
}

function receipt(
	input: ResolvedReconciliationInput,
	outcome: LibraryDatabaseOutcome,
): LibraryDatabaseReconciliationResult {
	return {
		outcome,
		databaseName: input.databaseName,
		loginName: input.loginName,
		databaseUrl: input.databaseUrl,
	};
}

async function existingDatabaseMatches(
	input: LockedReconciliationInput,
	role: ExistingLibraryRole,
) {
	const access = await readDatabaseAccessState(
		input.client,
		input.databaseName,
		input.loginName,
	);
	const target = await readTargetDatabaseState(input);
	return [
		role.canLogin,
		!role.canInherit,
		(await readRoleMemberships(input.client, input.loginName)).length === 0,
		accessStateMatches(access),
		target.extensionsMatch,
		target.migrationsMatch,
		await passwordMatches(input),
	].every(Boolean);
}

async function applyReconciliation(
	input: LockedReconciliationInput,
	role: ExistingLibraryRole | null,
	action: LibraryDatabaseAction,
) {
	await ensureRole({
		client: input.client,
		exists: role !== null,
		loginName: input.loginName,
		password: input.password,
	});
	if (action === "create") {
		await input.client.query(
			`CREATE DATABASE ${quotePostgresIdentifier(input.databaseName)} OWNER ${quotePostgresIdentifier(input.loginName)}`,
		);
	}
	await ensureExtensions(input);
	await ensureDatabaseAccess(input);
	await runMigrations(input);
	await verifyReconciliation(input);
}

async function reconcileUnderLock(input: LockedReconciliationInput) {
	const role = await readExistingRole(input.client, input.loginName);
	validateLibraryDatabaseTarget({
		adminUser: input.adminUser,
		database: input.databaseName,
		existingRole: role,
		user: input.loginName,
	});
	const action = decideLibraryDatabaseAction({
		existingOwner: await readDatabaseOwner(
			input.client,
			input.databaseName,
		),
		requestedOwner: input.loginName,
	});
	assertOwnsNoOtherDatabase(
		input.loginName,
		await readOwnedDatabaseNames(
			input.client,
			input.loginName,
			input.databaseName,
		),
	);
	if (
		action === "normalize" &&
		role &&
		(await existingDatabaseMatches(input, role))
	) {
		return receipt(input, "matched");
	}
	await applyReconciliation(input, role, action);
	return receipt(input, action === "create" ? "created" : "updated");
}

export async function reconcileLibraryDatabase(
	input: ReconcileLibraryDatabaseInput,
): Promise<LibraryDatabaseReconciliationResult> {
	const resolved = resolveReconciliationInput(input);
	const client = new Client({
		connectionString: resolved.adminUrl.toString(),
	});
	const lockName = `evidence-library-database:${resolved.databaseName}`;
	await client.connect();
	try {
		await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
			lockName,
		]);
		try {
			return await reconcileUnderLock({ ...resolved, client });
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

export async function reconcileOpenScholarLibraryDatabase(
	input: ReconcileOpenScholarLibraryDatabaseInput,
) {
	const names = deriveLibraryDatabaseNames(input.libraryId);
	return reconcileLibraryDatabase({
		adminUrl: input.adminUrl,
		databaseName: names.databaseName,
		loginName: names.loginName,
		password: input.password,
		runtimeHost: input.runtimeHost,
	});
}
