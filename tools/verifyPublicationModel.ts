import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import type { Database } from "@/db/database-schema";
import { allocateManagedCrossrefDoi } from "@/lib/publication/namespace-repository";

const { Client, Pool } = pg;

const configuredDatabaseUrl = process.env.DATABASE_URL_POST;
if (!configuredDatabaseUrl) throw new Error("DATABASE_URL_POST is required");
const databaseUrl: string = configuredDatabaseUrl;

let savepointNumber = 0;

async function expectConstraintViolation(
	client: pg.Client,
	label: string,
	constraint: string,
	operation: () => Promise<unknown>,
) {
	savepointNumber += 1;
	const savepoint = `publication_error_${savepointNumber}`;
	await client.query(`SAVEPOINT ${savepoint}`);

	try {
		await operation();
		await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
		throw new Error(`${label}: expected ${constraint} to reject`);
	} catch (error) {
		await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
		if ((error as { constraint?: string }).constraint !== constraint) {
			throw error;
		}
	} finally {
		await client.query(`RELEASE SAVEPOINT ${savepoint}`);
	}
}

async function verifyConstraints(client: pg.Client) {
	await client.query("BEGIN");
	try {
		await client.query(`
			INSERT INTO "itemIdentity"
				("key", "sourceConnectionKey", "sourceRecordKey")
			VALUES
				('D2TESTA2', 'native', 'D2TESTA2'),
				('D2TESTA3', 'native', 'D2TESTA3')
		`);
		await client.query(`
			INSERT INTO "item"
				("key", "sourceConnectionKey", "sourceRecordKey", "title")
			VALUES
				('D2TESTA2', 'native', 'D2TESTA2', 'Publication fixture one'),
				('D2TESTA3', 'native', 'D2TESTA3', 'Publication fixture two')
		`);

		await client.query(`
			INSERT INTO "publicationTarget"
				("itemKey", "provider", "environment", "requestedBy")
			VALUES ('D2TESTA2', 'crossref', 'test', 'model-test')
		`);
		await client.query(`
			INSERT INTO "publicationTarget"
				("itemKey", "provider", "environment", "identifierPolicy", "requestedBy")
			VALUES ('D2TESTA2', 'zenodo', 'sandbox', 'reuse-crossref', 'model-test')
		`);

		await expectConstraintViolation(
			client,
			"provider environment isolation",
			"publicationTarget_provider_environment_valid",
			() =>
				client.query(`
					INSERT INTO "publicationTarget"
						("itemKey", "provider", "environment", "requestedBy")
					VALUES ('D2TESTA3', 'crossref', 'sandbox', 'model-test')
				`),
		);
		await expectConstraintViolation(
			client,
			"Zenodo policy is required",
			"publicationTarget_identifier_policy_valid",
			() =>
				client.query(`
					INSERT INTO "publicationTarget"
						("itemKey", "provider", "environment", "requestedBy")
					VALUES ('D2TESTA3', 'zenodo', 'sandbox', 'model-test')
				`),
		);
		await expectConstraintViolation(
			client,
			"duplicate target activation",
			"publicationTarget_itemKey_provider_environment_pk",
			() =>
				client.query(`
					INSERT INTO "publicationTarget"
						("itemKey", "provider", "environment", "requestedBy")
					VALUES ('D2TESTA2', 'crossref', 'test', 'second-request')
				`),
		);

		await client.query(`
			INSERT INTO "publicationIdentifier"
				("itemKey", "registrar", "environment", "role", "doi", "ownership", "lifecycle", "isCurrent")
			VALUES ('D2TESTA2', 'crossref', 'test', 'primary', '10.5555/el.1', 'managed', 'reserved', true)
		`);
		await expectConstraintViolation(
			client,
			"reserved external identifier",
			"publicationIdentifier_external_verified",
			() =>
				client.query(`
					INSERT INTO "publicationIdentifier"
						("itemKey", "registrar", "environment", "role", "doi", "ownership", "lifecycle", "isCurrent")
					VALUES ('D2TESTA3', 'crossref', 'test', 'primary', '10.5555/external', 'external', 'reserved', true)
				`),
		);
		await expectConstraintViolation(
			client,
			"verified timestamp bundle",
			"publicationIdentifier_verified_bundle_valid",
			() =>
				client.query(`
					INSERT INTO "publicationIdentifier"
						("itemKey", "registrar", "environment", "role", "doi", "ownership", "lifecycle", "isCurrent")
					VALUES ('D2TESTA3', 'crossref', 'test', 'primary', '10.5555/missing-time', 'managed', 'verified', true)
				`),
		);
		await expectConstraintViolation(
			client,
			"one current identifier per role",
			"publicationIdentifier_current_role_unique",
			() =>
				client.query(`
					INSERT INTO "publicationIdentifier"
						("itemKey", "registrar", "environment", "role", "doi", "ownership", "lifecycle", "isCurrent")
					VALUES ('D2TESTA2', 'crossref', 'test', 'primary', '10.5555/el.2', 'managed', 'reserved', true)
				`),
		);

		await client.query(`
			INSERT INTO "publicationSyncState"
				("itemKey", "provider", "environment", "lastPayloadHash", "lastPayloadSnapshot")
			VALUES ('D2TESTA2', 'crossref', 'test', repeat('c', 64), '{}')
		`);
		await expectConstraintViolation(
			client,
			"Crossref state cannot contain file state",
			"publicationSyncState_provider_fields_valid",
			() =>
				client.query(`
					UPDATE "publicationSyncState"
					SET "lastFileManifestHash" = repeat('d', 64), "lastFileManifestSnapshot" = '{}'
					WHERE "itemKey" = 'D2TESTA2' AND "provider" = 'crossref'
				`),
		);
		await expectConstraintViolation(
			client,
			"last-success hash needs its snapshot",
			"publicationSyncState_last_success_bundle_valid",
			() =>
				client.query(`
					UPDATE "publicationSyncState"
					SET "lastPayloadSnapshot" = NULL
					WHERE "itemKey" = 'D2TESTA2' AND "provider" = 'crossref'
				`),
		);

		await client.query(`
			INSERT INTO "publicationSyncJob"
				("itemKey", "provider", "environment", "canonicalRevision", "reason", "idempotencyKey")
			VALUES ('D2TESTA2', 'crossref', 'test', 1, 'manual_activation', 'publication-model-job')
		`);
		await expectConstraintViolation(
			client,
			"job needs an active target",
			"publicationSyncJob_target_fk",
			() =>
				client.query(`
					INSERT INTO "publicationSyncJob"
						("itemKey", "provider", "environment", "canonicalRevision", "reason", "idempotencyKey")
					VALUES ('D2TESTA3', 'crossref', 'test', 1, 'manual_activation', 'missing-target-job')
				`),
		);
		await expectConstraintViolation(
			client,
			"job lease bundle",
			"publicationSyncJob_lease_bundle_valid",
			() =>
				client.query(`
					UPDATE "publicationSyncJob"
					SET "leaseOwner" = 'worker-without-expiry'
					WHERE "idempotencyKey" = 'publication-model-job'
				`),
		);
		await expectConstraintViolation(
			client,
			"job reason vocabulary",
			"publicationSyncJob_reason_valid",
			() =>
				client.query(`
					INSERT INTO "publicationSyncJob"
						("itemKey", "provider", "environment", "canonicalRevision", "reason", "idempotencyKey")
					VALUES ('D2TESTA2', 'crossref', 'test', 1, 'surprise', 'bad-reason-job')
				`),
		);
		await expectConstraintViolation(
			client,
			"job idempotency",
			"publicationSyncJob_idempotency_unique",
			() =>
				client.query(`
					INSERT INTO "publicationSyncJob"
						("itemKey", "provider", "environment", "canonicalRevision", "reason", "idempotencyKey")
					VALUES ('D2TESTA2', 'crossref', 'test', 1, 'manual_activation', 'publication-model-job')
				`),
		);
		await expectConstraintViolation(
			client,
			"processed job receipt bundle",
			"publicationSyncJob_receipt_bundle_valid",
			() =>
				client.query(`
					UPDATE "publicationSyncJob"
					SET "processedAt" = now()
					WHERE "idempotencyKey" = 'publication-model-job'
				`),
		);

		await client.query(`
			INSERT INTO "zenodoPublishJournal"
				("itemKey", "provider", "environment", "operationType", "payloadHash", "depositionId", "draftRecordId", "status")
			VALUES ('D2TESTA2', 'zenodo', 'sandbox', 'zenodo_create', repeat('a', 64), 'dep-1', 'draft-1', 'preparing')
		`);
		await expectConstraintViolation(
			client,
			"published journal bundle",
			"zenodoPublishJournal_published_bundle_valid",
			() =>
				client.query(`
					UPDATE "zenodoPublishJournal"
					SET "status" = 'published'
					WHERE "depositionId" = 'dep-1'
				`),
		);
		await expectConstraintViolation(
			client,
			"journal operation vocabulary",
			"zenodoPublishJournal_operation_valid",
			() =>
				client.query(`
					INSERT INTO "zenodoPublishJournal"
						("itemKey", "provider", "environment", "operationType", "payloadHash", "depositionId", "draftRecordId", "status")
					VALUES ('D2TESTA2', 'zenodo', 'sandbox', 'surprise', repeat('b', 64), 'dep-2', 'draft-2', 'preparing')
				`),
		);
		await expectConstraintViolation(
			client,
			"journal needs a Zenodo target",
			"zenodoPublishJournal_target_fk",
			() =>
				client.query(`
					INSERT INTO "zenodoPublishJournal"
						("itemKey", "provider", "environment", "operationType", "payloadHash", "depositionId", "draftRecordId", "status")
					VALUES ('D2TESTA3', 'zenodo', 'sandbox', 'zenodo_create', repeat('b', 64), 'dep-3', 'draft-3', 'preparing')
				`),
		);

		await client.query(`
			INSERT INTO "publicationSyncRun"
				("id", "trigger", "status", "leaseOwner", "leaseExpiresAt", "heartbeatAt")
			VALUES ('publication-model-run', 'manual', 'running', 'model-worker', now() + interval '5 minutes', now())
		`);
		await expectConstraintViolation(
			client,
			"completed run releases lease",
			"publicationSyncRun_state_bundle_valid",
			() =>
				client.query(`
					UPDATE "publicationSyncRun"
					SET "status" = 'succeeded', "completedAt" = now()
					WHERE "id" = 'publication-model-run'
				`),
		);
		await expectConstraintViolation(
			client,
			"run counts stay bounded",
			"publicationSyncRun_counts_valid",
			() =>
				client.query(`
					UPDATE "publicationSyncRun"
					SET "succeededJobs" = 1
					WHERE "id" = 'publication-model-run'
				`),
		);
	} finally {
		await client.query("ROLLBACK");
	}
}

async function verifyNamespaceAllocation(database: Database) {
	const allocated = await Promise.all(
		Array.from({ length: 20 }, () =>
			allocateManagedCrossrefDoi(database, {
				environment: "test",
				prefix: "10.5555",
				suffixNamespace: "model.",
			}),
		),
	);
	if (new Set(allocated).size !== allocated.length) {
		throw new Error("Concurrent DOI allocation returned a duplicate");
	}
	if (
		!allocated.every((doi) => /^10\.5555\/model\.\d{6}$/u.test(doi))
	) {
		throw new Error("DOI allocation did not use a six-digit sequence");
	}
	if (!allocated.includes("10.5555/model.000001")) {
		throw new Error("The first DOI did not start at 000001");
	}

	try {
		await allocateManagedCrossrefDoi(database, {
			environment: "test",
			prefix: "10.5555",
			suffixNamespace: "changed.",
		});
		throw new Error("A used DOI namespace was allowed to change");
	} catch (error) {
		if (!(error instanceof Error) || !error.message.includes("cannot change")) {
			throw error;
		}
	}
}

async function main() {
	const sourceUrl = new URL(databaseUrl);
	const databaseName = `publication_model_${process.pid}_${Date.now()}`;
	const adminUrl = new URL(sourceUrl);
	adminUrl.pathname = "/postgres";
	const temporaryUrl = new URL(sourceUrl);
	temporaryUrl.pathname = `/${databaseName}`;
	const admin = new Client({ connectionString: adminUrl.toString() });
	let client: pg.Client | null = null;
	let pool: pg.Pool | null = null;
	await admin.connect();
	try {
		await admin.query(`CREATE DATABASE "${databaseName}"`);
		pool = new Pool({ connectionString: temporaryUrl.toString(), max: 8 });
		const database = drizzle({ client: pool }) as unknown as Database;
		await migrate(database, { migrationsFolder: "drizzle" });
		client = new Client({ connectionString: temporaryUrl.toString() });
		await client.connect();
		await verifyConstraints(client);
		await verifyNamespaceAllocation(database);
	} finally {
		await client?.end();
		await pool?.end();
		await admin.query(
			`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
			[databaseName],
		);
		await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
		await admin.end();
	}
	console.log(
		"Publication model migration, constraints, and concurrent DOI allocation passed in an isolated database.",
	);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
