import {
	ProviderHttpError,
	type CrossrefDepositor,
} from "@opendeved/doi-sync-core";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { describe, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LibraryServerConfig } from "../src/config/library-config/schema";
import type { Database } from "../src/db/database-schema";
import { schema } from "../src/db/database-schema";
import {
	activateCrossrefPublication,
	CrossrefActivationValidationError,
	ExternalCrossrefDoiError,
	retryCrossrefPublication,
} from "../src/lib/publication/crossref-activation-service";
import { runCrossrefPublicationJobsOnce } from "../src/lib/publication/crossref-adapter";

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
			crossref: {
				enabled: true,
				environment: "test",
				loginId: "test-login",
				depositorName: "Evidence Library",
				email: "doi@example.org",
				password: "test-password",
				registrant: "Evidence Library",
				prefix: "10.5555",
				suffixNamespace: "library.",
			},
			zenodo: {
				enabled: false,
				environment: "sandbox",
				defaultIdentifierPolicy: "reuse-crossref",
				accessRight: "open",
				license: "cc-by-4.0",
			},
			worker: {
				batchSize: 25,
				leaseSeconds: 900,
				retryLimit: 2,
				nightlyUtcTime: "02:00",
			},
		},
	},
	sources: [],
} as unknown as LibraryServerConfig;

async function seedItem(
	client: Client,
	input: { key: string; doi?: string; itemType?: string },
) {
	await client.query(
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'zotero-activation', $1)`,
		[input.key],
	);
	await client.query(
		`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision", "title", "date", "creators", "institution", "DOI", "deleted")
		 VALUES ($1, 'zotero-activation', $1, $2, 1, 'Crossref activation record', '2026-08-12', $3::jsonb, 'OpenDevEd', $4, 0)`,
		[
			input.key,
			input.itemType ?? "Report",
			JSON.stringify([
				{
					creatorType: "author",
					firstName: "Ada",
					lastName: "Lovelace",
				},
			]),
			input.doi ?? null,
		],
	);
	await client.query(
		`INSERT INTO "itemSourceLink" ("itemKey", "sourceConnectionKey", "sourceRecordKey", "writebackEnabled") VALUES ($1, 'zotero-activation', $1, true)`,
		[input.key],
	);
}

function successfulProvider(): CrossrefDepositor {
	return {
		submitPublication: async (input) => {
			await input.onSubmitted?.();
			return {
				status: "succeeded",
				filename: input.filename,
				diagnostic: {
					status: "success",
					recordCount: 1,
					successCount: 1,
					failureCount: 0,
				},
				xmlVerification: { status: "matched" },
			};
		},
		verifyPublication: async () => ({ status: "matched" }),
	};
}

function pendingProvider(): CrossrefDepositor {
	return {
		submitPublication: async (input) => {
			await input.onSubmitted?.();
			return {
				status: "pending",
				filename: input.filename,
				diagnostic: {
					status: "pending",
					recordCount: 1,
					successCount: null,
					failureCount: 0,
				},
			};
		},
		verifyPublication: async () => ({ status: "matched" }),
	};
}

function failingProvider(): CrossrefDepositor {
	return {
		submitPublication: async (input) => {
			await input.onSubmitted?.();
			return {
				status: "failed",
				filename: input.filename,
				diagnostic: {
					status: "failed",
					recordCount: 1,
					successCount: 0,
					failureCount: 1,
				},
			};
		},
		verifyPublication: async () => ({ status: "pending" }),
	};
}

function transientProvider(): CrossrefDepositor {
	return {
		submitPublication: async () => {
			throw new ProviderHttpError({
				provider: "crossref",
				status: 503,
				body: "Crossref test is temporarily unavailable",
			});
		},
		verifyPublication: async () => ({ status: "pending" }),
	};
}

function leaseStealingProvider(
	client: Client,
	itemKey: string,
): CrossrefDepositor {
	return {
		submitPublication: async (input) => {
			await client.query(
				`UPDATE "publicationSyncJob"
				 SET "leaseOwner" = 'replacement-worker',
				     "leaseExpiresAt" = '2099-01-01T00:00:00Z'
				 WHERE "itemKey" = $1`,
				[itemKey],
			);
			await input.onSubmitted?.();
			return {
				status: "pending",
				filename: input.filename,
				diagnostic: {
					status: "pending",
					recordCount: 1,
					successCount: null,
					failureCount: 0,
				},
			};
		},
		verifyPublication: async () => ({ status: "pending" }),
	};
}

function delayedThenTransientProvider(): CrossrefDepositor {
	let verificationCount = 0;
	return {
		submitPublication: async (input) => {
			await input.onSubmitted?.();
			return {
				status: "pending",
				filename: input.filename,
				diagnostic: {
					status: "pending",
					recordCount: 1,
					successCount: null,
					failureCount: 0,
				},
			};
		},
		verifyPublication: async () => {
			verificationCount += 1;
			if (verificationCount === 1) return { status: "pending" };
			throw new ProviderHttpError({
				provider: "crossref",
				status: 503,
				body: "Crossref test is temporarily unavailable",
			});
		},
	};
}

function alwaysPendingProvider(): CrossrefDepositor {
	return {
		submitPublication: async (input) => {
			await input.onSubmitted?.();
			return {
				status: "pending",
				filename: input.filename,
				diagnostic: {
					status: "pending",
					recordCount: 1,
					successCount: null,
					failureCount: 0,
				},
			};
		},
		verifyPublication: async () => ({ status: "pending" }),
	};
}

function batchLeaseStealingProvider(
	client: Client,
	secondItemKey: string,
): CrossrefDepositor {
	let submissionCount = 0;
	return {
		submitPublication: async (input) => {
			submissionCount += 1;
			if (submissionCount === 1) {
				await client.query(
					`UPDATE "publicationSyncJob"
					 SET "leaseOwner" = 'batch-replacement-worker',
					     "leaseExpiresAt" = '2099-01-01T00:00:00Z'
					 WHERE "itemKey" = $1 AND "leaseOwner" = 'batch-worker'`,
					[secondItemKey],
				);
			}
			await input.onSubmitted?.();
			return {
				status: "succeeded",
				filename: input.filename,
				diagnostic: {
					status: "success",
					recordCount: 1,
					successCount: 1,
					failureCount: 0,
				},
				xmlVerification: { status: "matched" },
			};
		},
		verifyPublication: async () => ({ status: "matched" }),
	};
}

async function verify(database: Database, client: Client) {
	await client.query(
		`INSERT INTO "sourceConnection" ("key", "provider", "scopeKind", "externalScopeKey", "credentialRef", "defaultWriteback") VALUES ('zotero-activation', 'zotero', 'group', 'activation-test', 'test-key', true)`,
	);

	await seedItem(client, { key: "CRACTAAB" });
	const first = await activateCrossrefPublication(
		database,
		"CRACTAAB",
		config,
	);
	assert(
		first.doi === "10.5555/library.000001",
		"The first DOI was not reserved",
	);
	assert(
		first.canonicalRevision === 2,
		"Activation did not advance the revision",
	);
	const repeated = await activateCrossrefPublication(
		database,
		"CRACTAAB",
		config,
	);
	assert(
		repeated.job.id === first.job.id,
		"Repeated activation created another job",
	);
	try {
		await retryCrossrefPublication(database, "CRACTAAB");
		throw new Error("A healthy Crossref job was opened for manual retry");
	} catch (error) {
		assert(
			error instanceof CrossrefActivationValidationError &&
				error.message ===
					"This Crossref publication does not have a failed job to retry.",
			"A healthy Crossref job returned the wrong retry error",
		);
	}
	const activationRows = await client.query<{
		revision: string;
		doi: string;
		targets: string;
		identifiers: string;
		jobs: string;
		outbox: string;
		writeback: string;
	}>(`SELECT i."revision", i."DOI" AS doi,
		(SELECT count(*) FROM "publicationTarget" WHERE "itemKey" = i."key") AS targets,
		(SELECT count(*) FROM "publicationIdentifier" WHERE "itemKey" = i."key") AS identifiers,
		(SELECT count(*) FROM "publicationSyncJob" WHERE "itemKey" = i."key") AS jobs,
		(SELECT count(*) FROM "outbox" WHERE "entityKey" = i."key") AS outbox,
		(SELECT count(*) FROM "sourceWritebackJob" WHERE "itemKey" = i."key") AS writeback
		FROM "item" i WHERE i."key" = 'CRACTAAB'`);
	const activated = activationRows.rows[0];
	assert(
		activated?.revision === "2" &&
			activated.doi === first.doi &&
			activated.targets === "1" &&
			activated.identifiers === "1" &&
			activated.jobs === "1" &&
			activated.outbox === "1" &&
			activated.writeback === "1",
		"Activation facts did not commit together",
	);

	await seedItem(client, { key: "CRACTAAC" });
	const concurrent = await Promise.all(
		Array.from({ length: 8 }, () =>
			activateCrossrefPublication(database, "CRACTAAC", config),
		),
	);
	assert(
		new Set(concurrent.map(({ doi }) => doi)).size === 1 &&
			new Set(concurrent.map(({ job }) => job.id)).size === 1,
		"Concurrent activation was not idempotent",
	);

	await seedItem(client, { key: "CRACTAAD", doi: "10.9999/external" });
	try {
		await activateCrossrefPublication(database, "CRACTAAD", config);
		throw new Error("An external DOI was accepted");
	} catch (error) {
		if (!(error instanceof ExternalCrossrefDoiError)) throw error;
	}
	const externalRows = await client.query<{
		revision: string;
		targets: string;
	}>(
		`SELECT i."revision", (SELECT count(*) FROM "publicationTarget" WHERE "itemKey" = i."key") AS targets FROM "item" i WHERE i."key" = 'CRACTAAD'`,
	);
	assert(
		externalRows.rows[0]?.revision === "1" &&
			externalRows.rows[0]?.targets === "0",
		"Rejected activation left committed publication state",
	);
	await seedItem(client, { key: "CRACTAAG", itemType: "Artwork" });
	try {
		await activateCrossrefPublication(database, "CRACTAAG", config);
		throw new Error("An unsupported item type was accepted");
	} catch (error) {
		if (!(error instanceof CrossrefActivationValidationError)) throw error;
	}
	const rejectedType = await client.query<{
		revision: string;
		targets: string;
	}>(
		`SELECT i."revision", (SELECT count(*) FROM "publicationTarget" WHERE "itemKey" = i."key") AS targets FROM "item" i WHERE i."key" = 'CRACTAAG'`,
	);
	assert(
		rejectedType.rows[0]?.revision === "1" &&
			rejectedType.rows[0]?.targets === "0",
		"Unsupported metadata consumed a DOI or left activation state",
	);
	await seedItem(client, { key: "CRACTAAH", doi: "10.5555/existing" });
	const existing = await activateCrossrefPublication(
		database,
		"CRACTAAH",
		config,
	);
	assert(
		existing.doi === "10.5555/existing" && existing.canonicalRevision === 1,
		"An existing managed-prefix DOI created a fake item revision",
	);
	const existingRows = await client.query<{
		revision: string;
		writeback: string;
		outbox: string;
	}>(`SELECT i."revision",
		(SELECT count(*) FROM "sourceWritebackJob" WHERE "itemKey" = i."key") AS writeback,
		(SELECT count(*) FROM "outbox" WHERE "entityKey" = i."key") AS outbox
		FROM "item" i WHERE i."key" = 'CRACTAAH'`);
	assert(
		existingRows.rows[0]?.revision === "1" &&
			existingRows.rows[0]?.writeback === "0" &&
			existingRows.rows[0]?.outbox === "1",
		"Existing DOI activation did not separate publication state from item edits",
	);
	await seedItem(client, { key: "CRACTAAL", doi: "10.5555/existing" });
	try {
		await activateCrossrefPublication(database, "CRACTAAL", config);
		throw new Error("A DOI already managed by another record was accepted");
	} catch (error) {
		assert(
			error instanceof Error &&
				error.message ===
					"DOI 10.5555/existing is already managed by record CRACTAAH.",
			"The duplicate DOI error did not identify the existing record",
		);
	}

	const successful = await runCrossrefPublicationJobsOnce(database, config, {
		provider: successfulProvider(),
		workerId: "successful-worker",
		now: () => new Date("2030-08-12T23:00:00Z"),
	});
	assert(
		successful.filter(({ status }) => status === "succeeded").length === 3,
		`Successful jobs did not settle: ${JSON.stringify(successful)}`,
	);
	const settled = await client.query<{
		lifecycle: string;
		verifiedAt: Date | null;
		revision: string;
		writeback: string;
		processedAt: Date | null;
		pendingStage: string | null;
	}>(`SELECT pi."lifecycle", pi."verifiedAt", i."revision",
		(SELECT count(*) FROM "sourceWritebackJob" WHERE "itemKey" = i."key") AS writeback,
		psj."processedAt", pss."pendingStage"
		FROM "publicationIdentifier" pi
		JOIN "item" i ON i."key" = pi."itemKey"
		JOIN "publicationSyncJob" psj ON psj."itemKey" = i."key"
		JOIN "publicationSyncState" pss ON pss."itemKey" = i."key" AND pss."provider" = 'crossref'
		WHERE i."key" = 'CRACTAAB'`);
	assert(
		settled.rows[0]?.lifecycle === "verified" &&
			settled.rows[0]?.verifiedAt &&
			settled.rows[0]?.revision === "2" &&
			settled.rows[0]?.writeback === "1" &&
			settled.rows[0]?.processedAt &&
			settled.rows[0]?.pendingStage === null,
		"Verified settlement changed the wrong durable facts",
	);

	await seedItem(client, { key: "CRACTAAE" });
	const pendingActivation = await activateCrossrefPublication(
		database,
		"CRACTAAE",
		config,
	);
	assert(
		pendingActivation.doi === "10.5555/library.000003",
		"A rejected activation consumed a DOI sequence",
	);
	const pendingAt = new Date("2030-08-13T13:00:00Z");
	const pending = await runCrossrefPublicationJobsOnce(database, config, {
		provider: pendingProvider(),
		workerId: "pending-worker",
		now: () => pendingAt,
	});
	assert(
		pending[0]?.status === "verifying",
		"Pending deposit was not kept for verification",
	);
	const pendingRow = await client.query<{
		pendingStage: string | null;
		processedAt: Date | null;
	}>(
		`SELECT pss."pendingStage", psj."processedAt" FROM "publicationSyncState" pss JOIN "publicationSyncJob" psj ON psj."itemKey" = pss."itemKey" WHERE pss."itemKey" = 'CRACTAAE'`,
	);
	assert(
		pendingRow.rows[0]?.pendingStage === "deposit" &&
			pendingRow.rows[0]?.processedAt === null,
		"Pending verification was reported as complete",
	);
	const resumed = await runCrossrefPublicationJobsOnce(database, config, {
		provider: pendingProvider(),
		workerId: "resumed-worker",
		now: () => new Date(pendingAt.getTime() + 61_000),
	});
	assert(
		resumed[0]?.status === "succeeded",
		"Saved pending state did not resume",
	);

	await seedItem(client, { key: "CRACTAAF" });
	await activateCrossrefPublication(database, "CRACTAAF", config);
	const failedAt = new Date("2030-08-14T14:00:00Z");
	await runCrossrefPublicationJobsOnce(database, config, {
		provider: failingProvider(),
		workerId: "failed-worker-one",
		now: () => failedAt,
	});
	const failedRow = await client.query<{
		deadLetteredAt: Date | null;
		attempts: number;
	}>(
		`SELECT "deadLetteredAt", "attempts" FROM "publicationSyncJob" WHERE "itemKey" = 'CRACTAAF'`,
	);
	assert(
		failedRow.rows[0]?.deadLetteredAt && failedRow.rows[0]?.attempts === 1,
		"A terminal Crossref failure was not dead-lettered",
	);
	await client.query(
		`INSERT INTO "publicationSyncJob"
		 ("itemKey", "provider", "environment", "canonicalRevision", "reason", "idempotencyKey", "nextAttemptAt", "supersededAt")
		 VALUES ('CRACTAAF', 'crossref', 'test', 2, 'record_changed', 'publication:crossref:test:CRACTAAF:superseded', now(), now())`,
	);
	const retried = await retryCrossrefPublication(database, "CRACTAAF");
	assert(
		retried.job.state === "retrying",
		"Manual retry did not reopen the same job",
	);

	await seedItem(client, { key: "CRACTAAJ" });
	const transientActivation = await activateCrossrefPublication(
		database,
		"CRACTAAJ",
		config,
	);
	const transient = await runCrossrefPublicationJobsOnce(database, config, {
		provider: transientProvider(),
		workerId: "transient-worker",
		now: () => new Date("2030-08-15T14:00:00Z"),
	});
	assert(
		transient.find(({ jobId }) => jobId === transientActivation.job.id)
			?.status === "retrying",
		"A temporary Crossref failure was not scheduled for retry",
	);
	await runCrossrefPublicationJobsOnce(database, config, {
		provider: successfulProvider(),
		workerId: "transient-recovery-worker",
		now: () => new Date("2030-08-15T14:01:01Z"),
	});

	await seedItem(client, { key: "CRACTAAM" });
	const delayedActivation = await activateCrossrefPublication(
		database,
		"CRACTAAM",
		config,
	);
	const delayedProvider = delayedThenTransientProvider();
	const delayedAt = new Date("2030-08-16T10:00:00Z");
	await runCrossrefPublicationJobsOnce(database, config, {
		provider: delayedProvider,
		workerId: "delayed-submit-worker",
		now: () => delayedAt,
	});
	await runCrossrefPublicationJobsOnce(database, config, {
		provider: delayedProvider,
		workerId: "delayed-poll-worker",
		now: () => new Date(delayedAt.getTime() + 61_000),
	});
	const delayedFailure = await runCrossrefPublicationJobsOnce(
		database,
		config,
		{
			provider: delayedProvider,
			workerId: "delayed-failure-worker",
			now: () => new Date(delayedAt.getTime() + 122_000),
		},
	);
	assert(
		delayedFailure.find(({ jobId }) => jobId === delayedActivation.job.id)
			?.status === "retrying",
		`Pending verification consumed the transient failure retry budget for ${String(delayedActivation.job.id)}: ${JSON.stringify(delayedFailure)}`,
	);
	const delayedJob = await client.query<{ deadLetteredAt: Date | null }>(
		`SELECT "deadLetteredAt" FROM "publicationSyncJob" WHERE "id" = $1`,
		[delayedActivation.job.id],
	);
	assert(
		delayedJob.rows[0]?.deadLetteredAt == null,
		"A first transient failure was dead-lettered after pending checks",
	);
	const delayedRecovery = await runCrossrefPublicationJobsOnce(
		database,
		config,
		{
			provider: successfulProvider(),
			workerId: "delayed-recovery-worker",
			now: () => new Date(delayedAt.getTime() + 183_000),
		},
	);
	assert(
		delayedRecovery.find(({ jobId }) => jobId === delayedActivation.job.id)
			?.status === "succeeded",
		`The delayed Crossref job did not recover: ${JSON.stringify(delayedRecovery)}`,
	);

	await seedItem(client, { key: "CRACTAAK" });
	const stolenActivation = await activateCrossrefPublication(
		database,
		"CRACTAAK",
		config,
	);
	const stolen = await runCrossrefPublicationJobsOnce(database, config, {
		provider: leaseStealingProvider(client, "CRACTAAK"),
		workerId: "stale-worker",
		now: () => new Date("2030-08-16T14:00:00Z"),
	});
	assert(
		stolen.find(({ jobId }) => jobId === stolenActivation.job.id)
			?.status === "lease_lost",
		"A stale worker did not report its lost lease",
	);
	const staleState = await client.query<{ pendingStage: string | null }>(
		`SELECT "pendingStage" FROM "publicationSyncState" WHERE "itemKey" = 'CRACTAAK'`,
	);
	assert(
		staleState.rows[0]?.pendingStage == null,
		"A stale worker left a pending Crossref journal behind",
	);

	await seedItem(client, { key: "CRACTAAN" });
	await seedItem(client, { key: "CRACTAAP" });
	const firstBatch = await activateCrossrefPublication(
		database,
		"CRACTAAN",
		config,
	);
	const secondBatch = await activateCrossrefPublication(
		database,
		"CRACTAAP",
		config,
	);
	const batch = await runCrossrefPublicationJobsOnce(database, config, {
		provider: batchLeaseStealingProvider(client, "CRACTAAP"),
		workerId: "batch-worker",
		now: () => new Date("2030-08-17T14:00:00Z"),
	});
	for (const activation of [firstBatch, secondBatch]) {
		assert(
			batch.find(({ jobId }) => jobId === activation.job.id)?.status ===
				"succeeded",
			`A late batch job lost its lease before processing: ${JSON.stringify(batch)}`,
		);
	}

	await seedItem(client, { key: "CRACTAAQ" });
	const stalePendingActivation = await activateCrossrefPublication(
		database,
		"CRACTAAQ",
		config,
	);
	const stalePendingProvider = alwaysPendingProvider();
	const stalePendingAt = new Date("2030-08-18T10:00:00Z");
	await runCrossrefPublicationJobsOnce(database, config, {
		provider: stalePendingProvider,
		workerId: "stale-pending-submit-worker",
		now: () => stalePendingAt,
	});
	const stalePending = await runCrossrefPublicationJobsOnce(
		database,
		config,
		{
			provider: stalePendingProvider,
			workerId: "stale-pending-check-worker",
			now: () =>
				new Date(
					stalePendingAt.getTime() + 24 * 60 * 60 * 1_000 + 61_000,
				),
		},
	);
	assert(
		stalePending.find(
			({ jobId }) => jobId === stalePendingActivation.job.id,
		)?.status === "failed",
		"Crossref verification stayed pending past its maximum age",
	);
	const stalePendingState = await client.query<{
		deadLetteredAt: Date | null;
		lastFailureClass: string | null;
	}>(
		`SELECT psj."deadLetteredAt", pss."lastFailureClass"
		 FROM "publicationSyncJob" psj
		 JOIN "publicationSyncState" pss ON pss."itemKey" = psj."itemKey" AND pss."provider" = psj."provider" AND pss."environment" = psj."environment"
		 WHERE psj."id" = $1`,
		[stalePendingActivation.job.id],
	);
	assert(
		stalePendingState.rows[0]?.deadLetteredAt != null &&
			stalePendingState.rows[0]?.lastFailureClass ===
				"CROSSREF_PENDING_STALE",
		"Stale Crossref verification did not become a visible failed job",
	);
}

async function verifyIsolatedDatabase() {
	const sourceUrl = new URL(verifiedDatabaseUrl);
	const databaseName = `crossref_activation_${process.pid}_${Date.now()}`;
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
		const database = drizzle({
			client: pool,
			schema,
		}) as unknown as Database;
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
	console.log(
		"Crossref activation, idempotency, writeback, pending recovery, settlement, and retry passed in an isolated database.",
	);
}

describe("Crossref activation against an isolated database", () => {
	it("keeps activation, provider settlement, and retry durable", async () => {
		await verifyIsolatedDatabase();
	}, 120_000);
});
