import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LibraryServerConfig } from "../src/config/library-config/schema";
import type { Database } from "../src/db/database-schema";
import { schema } from "../src/db/database-schema";
import {
	activateZenodoPublication,
	retryZenodoPublication,
	ZenodoActivationValidationError,
	ZenodoIdentifierPolicyLockedError,
} from "../src/lib/publication/zenodo-activation-service";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const config = {
	identity: { baseUrl: "https://library.example.org" },
	services: {
		publication: {
			crossref: { enabled: true, environment: "test" },
			zenodo: {
				enabled: true,
				environment: "sandbox",
				token: "sandbox-token",
				defaultIdentifierPolicy: "reuse-crossref",
				accessRight: "open",
				license: "cc-by-4.0",
			},
			worker: {
				batchSize: 25,
				leaseSeconds: 900,
				retryLimit: 8,
				nightlyUtcTime: "02:00",
			},
		},
	},
} as unknown as LibraryServerConfig;

async function seedParent(
	client: Client,
	input: { key: string; doi?: string },
) {
	await client.query(
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'native', $1)`,
		[input.key],
	);
	await client.query(
		`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision", "title", "abstractNote", "date", "creators", "institution", "DOI", "deleted")
		 VALUES ($1, 'native', $1, 'Report', 1, 'Zenodo activation record', 'A complete description.', '2026-08-13', $2::jsonb, 'OpenDevEd', $3, 0)`,
		[
			input.key,
			JSON.stringify([
				{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
			]),
			input.doi ?? null,
		],
	);
}

async function seedPublishedFile(client: Client, parentKey: string, fileKey: string) {
	await client.query(
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'native', $1)`,
		[fileKey],
	);
	await client.query(
		`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision", "title", "parentItem", "deleted")
		 VALUES ($1, 'native', $1, 'Attachment', 1, 'Published PDF', $2, 0)`,
		[fileKey, parentKey],
	);
	await client.query(
		`INSERT INTO "itemFilePublication" (
			"itemKey", "sourceConnectionKey", "parentItemKey", "uploadRevision", "revision",
			"sourceObjectPath", "sourceCoverObjectPath", "objectPath", "publicUrl", "filename",
			"contentType", "sizeBytes", "sha256", "coverObjectPath", "coverPublicUrl",
			"coverWidth", "coverHeight", "pageCount", "publicationTags", "publishedAt"
		) VALUES (
			$1, 'native', $2, 1, 1,
			$3, $4, $5, $6, $7,
			'application/pdf', 12, $8, $9, $10,
			100, 140, 1, '[]'::jsonb, now()
		)`,
		[
			fileKey,
			parentKey,
			`private/${fileKey}.pdf`,
			`private/${fileKey}.png`,
			`public/${fileKey}.pdf`,
			`https://files.example.org/${fileKey}.pdf`,
			`${fileKey}.pdf`,
			"a".repeat(64),
			`public/${fileKey}.png`,
			`https://files.example.org/${fileKey}.png`,
		],
	);
}

async function seedCrossref(
	client: Client,
	input: {
		itemKey: string;
		doi: string;
		lifecycle: "reserved" | "verified";
	},
) {
	await client.query(
		`INSERT INTO "publicationTarget" ("itemKey", "provider", "environment", "requestedBy")
		 VALUES ($1, 'crossref', 'test', 'zenodo-test')`,
		[input.itemKey],
	);
	await client.query(
		`INSERT INTO "publicationIdentifier" (
			"itemKey", "registrar", "environment", "role", "doi", "ownership", "lifecycle", "verifiedAt"
		) VALUES ($1, 'crossref', 'test', 'primary', $2, 'managed', $3, $4)`,
		[
			input.itemKey,
			input.doi,
			input.lifecycle,
			input.lifecycle === "verified" ? new Date() : null,
		],
	);
}

async function verify(database: Database, client: Client) {
	await seedParent(client, { key: "ZENACTAA" });
	const fileless = await activateZenodoPublication(
		database,
		"ZENACTAA",
		config,
		"mint-zenodo",
	);
	assert(fileless.state === "waiting_for_file", "Fileless activation did not wait");
	assert(fileless.job === null, "Fileless activation created a provider job");
	const repeated = await activateZenodoPublication(
		database,
		"ZENACTAA",
		config,
		"mint-zenodo",
	);
	assert(repeated.job === null, "Repeated fileless activation created a job");
	const filelessRows = await client.query<{ targets: string; jobs: string }>(
		`SELECT
			(SELECT count(*) FROM "publicationTarget" WHERE "itemKey" = 'ZENACTAA')::text AS targets,
			(SELECT count(*) FROM "publicationSyncJob" WHERE "itemKey" = 'ZENACTAA')::text AS jobs`,
	);
	assert(
		filelessRows.rows[0]?.targets === "1" && filelessRows.rows[0]?.jobs === "0",
		"Fileless activation was not idempotent",
	);

	await seedParent(client, { key: "ZENACTAB", doi: "10.5555/library.2" });
	await seedPublishedFile(client, "ZENACTAB", "ZENFILAB");
	await seedCrossref(client, {
		itemKey: "ZENACTAB",
		doi: "10.5555/library.2",
		lifecycle: "reserved",
	});
	const crossrefWaiting = await activateZenodoPublication(
		database,
		"ZENACTAB",
		config,
	);
	assert(
		crossrefWaiting.state === "waiting_for_crossref" &&
			crossrefWaiting.job === null,
		"Reserved Crossref DOI did not wait locally",
	);
	await client.query(
		`UPDATE "publicationIdentifier" SET "lifecycle" = 'verified', "verifiedAt" = now() WHERE "itemKey" = 'ZENACTAB' AND "registrar" = 'crossref'`,
	);
	const ready = await activateZenodoPublication(database, "ZENACTAB", config);
	assert(ready.state === "queued" && ready.job !== null, "Ready target was not queued");
	const repeatedReady = await activateZenodoPublication(
		database,
		"ZENACTAB",
		config,
	);
	assert(
		repeatedReady.job?.id === ready.job.id,
		"Repeated ready activation created another job",
	);
	try {
		await retryZenodoPublication(database, "ZENACTAB", config);
		throw new Error("A healthy Zenodo job was retried");
	} catch (error) {
		if (!(error instanceof ZenodoActivationValidationError)) throw error;
	}

	await seedParent(client, { key: "ZENACTAC" });
	await seedPublishedFile(client, "ZENACTAC", "ZENFILAC");
	const independent = await activateZenodoPublication(
		database,
		"ZENACTAC",
		config,
		"mint-zenodo",
	);
	assert(
		independent.state === "queued" && independent.job !== null,
		"Zenodo DOI activation wrongly required Crossref",
	);
	await client.query(
		`UPDATE "item" SET "revision" = 2 WHERE "key" = 'ZENACTAC'`,
	);
	const revised = await activateZenodoPublication(
		database,
		"ZENACTAC",
		config,
		"mint-zenodo",
	);
	assert(
		revised.job !== null && revised.job.id !== independent.job.id,
		"A new canonical revision did not replace its old job",
	);
	const revisedJobs = await client.query<{ active: string; superseded: string }>(
		`SELECT
			count(*) FILTER (WHERE "processedAt" IS NULL AND "deadLetteredAt" IS NULL AND "supersededAt" IS NULL)::text AS active,
			count(*) FILTER (WHERE "supersededAt" IS NOT NULL)::text AS superseded
		 FROM "publicationSyncJob" WHERE "itemKey" = 'ZENACTAC'`,
	);
	assert(
		revisedJobs.rows[0]?.active === "1" && revisedJobs.rows[0]?.superseded === "1",
		"A revised activation left duplicate active jobs",
	);

	await seedParent(client, { key: "ZENACTAF" });
	await seedPublishedFile(client, "ZENACTAF", "ZENFILAF");
	const oldPolicy = await activateZenodoPublication(
		database,
		"ZENACTAF",
		config,
		"mint-zenodo",
	);
	await seedCrossref(client, {
		itemKey: "ZENACTAF",
		doi: "10.5555/library.6",
		lifecycle: "reserved",
	});
	await client.query(
		`UPDATE "item" SET "DOI" = '10.5555/library.6' WHERE "key" = 'ZENACTAF'`,
	);
	const changedPolicy = await activateZenodoPublication(
		database,
		"ZENACTAF",
		config,
		"reuse-crossref",
	);
	assert(
		changedPolicy.state === "waiting_for_crossref" && changedPolicy.job === null,
		"A policy change returned its superseded job",
	);
	const oldPolicyJob = await client.query<{ supersededAt: Date | null }>(
		`SELECT "supersededAt" FROM "publicationSyncJob" WHERE "id" = $1`,
		[oldPolicy.job?.id],
	);
	assert(
		oldPolicyJob.rows[0]?.supersededAt != null,
		"A waiting policy change left the old job active",
	);

	await seedParent(client, { key: "ZENACTAG" });
	await seedPublishedFile(client, "ZENACTAG", "ZENFILAG");
	const beforeUnpublish = await activateZenodoPublication(
		database,
		"ZENACTAG",
		config,
		"mint-zenodo",
	);
	await client.query(
		`DELETE FROM "itemFilePublication" WHERE "parentItemKey" = 'ZENACTAG'`,
	);
	const afterUnpublish = await activateZenodoPublication(
		database,
		"ZENACTAG",
		config,
		"mint-zenodo",
	);
	assert(
		afterUnpublish.state === "waiting_for_file" && afterUnpublish.job === null,
		"File removal left a stale job in the activation receipt",
	);
	const unpublishedJob = await client.query<{ supersededAt: Date | null }>(
		`SELECT "supersededAt" FROM "publicationSyncJob" WHERE "id" = $1`,
		[beforeUnpublish.job?.id],
	);
	assert(
		unpublishedJob.rows[0]?.supersededAt != null,
		"File removal left the old provider job claimable",
	);

	await seedParent(client, { key: "ZENACTAH" });
	await seedPublishedFile(client, "ZENACTAH", "ZENFILAH");
	const failed = await activateZenodoPublication(
		database,
		"ZENACTAH",
		config,
		"mint-zenodo",
	);
	await client.query(
		`UPDATE "publicationSyncJob" SET "deadLetteredAt" = now(), "lastError" = 'failed' WHERE "id" = $1`,
		[failed.job?.id],
	);
	await client.query(
		`DELETE FROM "itemFilePublication" WHERE "parentItemKey" = 'ZENACTAH'`,
	);
	try {
		await retryZenodoPublication(database, "ZENACTAH", config);
		throw new Error("A fileless Zenodo job was retried");
	} catch (error) {
		if (!(error instanceof ZenodoActivationValidationError)) throw error;
	}

	await seedParent(client, { key: "ZENACTAI" });
	await seedPublishedFile(client, "ZENACTAI", "ZENFILAI");
	const leased = await activateZenodoPublication(
		database,
		"ZENACTAI",
		config,
		"mint-zenodo",
	);
	await client.query(
		`UPDATE "publicationSyncJob" SET "leaseOwner" = 'worker', "leaseExpiresAt" = '2099-01-01T00:00:00Z' WHERE "id" = $1`,
		[leased.job?.id],
	);
	await seedCrossref(client, {
		itemKey: "ZENACTAI",
		doi: "10.5555/library.9",
		lifecycle: "verified",
	});
	await client.query(
		`UPDATE "item" SET "DOI" = '10.5555/library.9' WHERE "key" = 'ZENACTAI'`,
	);
	try {
		await activateZenodoPublication(
			database,
			"ZENACTAI",
			config,
			"reuse-crossref",
		);
		throw new Error("An in-flight Zenodo policy was changed");
	} catch (error) {
		if (!(error instanceof ZenodoIdentifierPolicyLockedError)) throw error;
	}

	await seedParent(client, { key: "ZENACTAD", doi: "10.9999/external" });
	for (const policy of ["reuse-crossref", "mint-zenodo"] as const) {
		try {
			await activateZenodoPublication(database, "ZENACTAD", config, policy);
			throw new Error(`External DOI allowed ${policy}`);
		} catch (error) {
			if (!(error instanceof ZenodoActivationValidationError)) throw error;
		}
	}
	const externalTarget = await client.query(
		`SELECT 1 FROM "publicationTarget" WHERE "itemKey" = 'ZENACTAD'`,
	);
	assert(externalTarget.rowCount === 0, "Rejected external DOI saved a target");

	await seedParent(client, { key: "ZENACTAE" });
	try {
		await activateZenodoPublication(database, "ZENACTAE", config);
		throw new Error("Crossref reuse succeeded without Crossref");
	} catch (error) {
		if (!(error instanceof ZenodoActivationValidationError)) throw error;
	}

	await client.query(
		`INSERT INTO "publicationSyncState" (
			"itemKey", "provider", "environment", "identifierPolicy", "lastPayloadHash", "lastPayloadSnapshot",
			"lastFileManifestHash", "lastFileManifestSnapshot", "zenodoRecordId", "zenodoParentId"
		) VALUES (
			'ZENACTAC', 'zenodo', 'sandbox', 'mint-zenodo', $1, '{}'::jsonb,
			$2, '{}'::jsonb, '1002', '1000'
		)`,
		["b".repeat(64), "c".repeat(64)],
	);
	await seedCrossref(client, {
		itemKey: "ZENACTAC",
		doi: "10.5555/library.3",
		lifecycle: "verified",
	});
	await client.query(`UPDATE "item" SET "DOI" = '10.5555/library.3' WHERE "key" = 'ZENACTAC'`);
	try {
		await activateZenodoPublication(
			database,
			"ZENACTAC",
			config,
			"reuse-crossref",
		);
		throw new Error("Published Zenodo policy was changed");
	} catch (error) {
		if (!(error instanceof ZenodoIdentifierPolicyLockedError)) throw error;
	}
}

async function verifyIsolatedDatabase() {
	const sourceUrl = new URL(verifiedDatabaseUrl);
	const databaseName = `zenodo_activation_${process.pid}_${Date.now()}`;
	const adminUrl = new URL(sourceUrl);
	adminUrl.pathname = "/postgres";
	const temporaryUrl = new URL(sourceUrl);
	temporaryUrl.pathname = `/${databaseName}`;
	const admin = new Client({ connectionString: adminUrl.toString() });
	let client: Client | null = null;
	let pool: Pool | null = null;
	await admin.connect();
	try {
		await admin.query(`CREATE DATABASE "${databaseName}"`);
		pool = new Pool({ connectionString: temporaryUrl.toString(), max: 12 });
		const database = drizzle({ client: pool, schema }) as unknown as Database;
		await migrate(database, { migrationsFolder: "drizzle" });
		client = new Client({ connectionString: temporaryUrl.toString() });
		await client.connect();
		await verify(database, client);
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
}

describe("Zenodo activation against an isolated database", () => {
	it("keeps policy, dependencies, and jobs durable", async () => {
		await verifyIsolatedDatabase();
	}, 120_000);
});
