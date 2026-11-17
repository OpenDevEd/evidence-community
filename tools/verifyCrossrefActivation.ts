import assert from "node:assert/strict";
import { publicationTestConfig } from "../tests/fixtures/publication-config";
import { savePublicationJob } from "../src/lib/publication/queue";
import {
	createNativeItemDraft,
	publishItemDraft,
} from "../src/lib/admin/native-item-service";
import { setItemPublishingChoice } from "../src/lib/admin/review-service";
import {
	ProviderHttpError,
	type CrossrefDepositor,
} from "@opendeved/doi-sync-core";
import { setTimeout as delay } from "node:timers/promises";
import type { Client } from "pg";
import { withIsolatedPublicationDatabase } from "../tests/helpers/isolated-publication-database";
import { describe, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LibraryServerConfig } from "../src/config/library-config/schema";
import type { Database } from "../src/db/database-schema";
import {
	activateCrossrefPublication,
	reserveCrossrefDoi,
	CrossrefActivationValidationError,
	ExternalCrossrefDoiError,
	retryCrossrefPublication,
} from "../src/lib/publication/crossref-activation-service";
import {
	buildCrossrefPlan,
	runCrossrefPublicationJobsOnce,
} from "../src/lib/publication/crossref-adapter";

const config = publicationTestConfig({ retryLimit: 2 });

async function seedItem(
	client: Client,
	input: { key: string; doi?: string; itemType?: string },
) {
	await client.query(
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'zotero-activation', $1)`,
		[input.key],
	);
	await client.query(
		`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision", "title", "date", "creators", "publisher", "DOI", "deleted", "licence")
		 VALUES ($1, 'zotero-activation', $1, $2, 1, 'Crossref activation record', '2026-08-12', $3::jsonb, 'OpenDevEd', $4, 0, '{"kind":"zenodo","id":"cc-by-4.0"}'::jsonb)`,
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

async function seedPublishedFile(
	client: Client,
	parentKey: string,
	fileKey: string,
) {
	await client.query(
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'zotero-activation', $1)`,
		[fileKey],
	);
	await client.query(
		`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "parentItem", "revision", "title", "deleted")
		 VALUES ($1, 'zotero-activation', $1, 'Attachment', $2, 1, 'Crossref wake PDF', 0)`,
		[fileKey, parentKey],
	);
	await client.query(
		`INSERT INTO "itemFilePublication" (
			"itemKey", "sourceConnectionKey", "parentItemKey", "uploadRevision", "revision",
			"sourceObjectPath", "sourceCoverObjectPath", "objectPath", "publicUrl", "filename",
			"contentType", "sizeBytes", "sha256", "md5", "coverObjectPath", "coverPublicUrl",
			"coverWidth", "coverHeight", "pageCount", "publicationTags", "publishedAt"
		) VALUES (
			$1, 'zotero-activation', $2, 1, 1,
			$3, $4, $5, $6, $7,
			'application/pdf', 12, $8, $9, $10, $11,
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
			"b".repeat(32),
			`public/${fileKey}.png`,
			`https://files.example.org/${fileKey}.png`,
		],
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

function slowSuccessfulProvider(): CrossrefDepositor {
	return {
		submitPublication: async (input) => {
			await delay(1_200);
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
		`INSERT INTO "sourceConnection" ("key", "provider", "scopeKind", "externalScopeKey")
		 VALUES ('zotero-activation', 'zotero', 'group', 'activation-test')`,
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
		await retryCrossrefPublication(database, "CRACTAAB", config);
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
	await seedItem(client, { key: "CRACTAAH" });
	await client.query(
		`UPDATE "itemIdentity" SET kind = 'created' WHERE key = 'CRACTAAH'`,
	);
	await setItemPublishingChoice(database, "CRACTAAH", {
		route: "crossref-zenodo",
		identifierPolicy: "reuse-crossref",
	}, config);
	const reservedExisting = await reserveCrossrefDoi(
		database,
		"CRACTAAH",
		config,
		"creator",
	);
	await client.query(`UPDATE item SET "DOI" = $1 WHERE key = 'CRACTAAH'`, [
		reservedExisting.doi,
	]);
	const existing = await activateCrossrefPublication(
		database,
		"CRACTAAH",
		config,
	);
	assert(
		existing.doi === reservedExisting.doi &&
			existing.canonicalRevision === 1,
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
	await seedItem(client, { key: "CRACTAAL", doi: reservedExisting.doi });
	try {
		await activateCrossrefPublication(database, "CRACTAAL", config);
		throw new Error("A DOI already managed by another record was accepted");
	} catch (error) {
		assert(
			error instanceof ExternalCrossrefDoiError,
			"An item claimed an identifier reserved by another item",
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
	const auditBaseline = await client.query<{
		payloadHash: string;
		payloadSnapshot: Record<string, unknown>;
	}>(
		`SELECT
			"lastPayloadHash" AS "payloadHash",
			"lastPayloadSnapshot" AS "payloadSnapshot"
		 FROM "publicationSyncState"
		 WHERE "itemKey" = 'CRACTAAB' AND "provider" = 'crossref'`,
	);
	const baseline = auditBaseline.rows[0];
	assert(
		baseline?.payloadHash && baseline.payloadSnapshot,
		"The Crossref audit fixture has no saved provider state",
	);
	const auditConfig = {
		...config,
		services: {
			...config.services,
			publication: {
				...config.services.publication,
				worker: { ...config.services.publication.worker, batchSize: 1 },
			},
		},
	} as LibraryServerConfig;
	const matchedAudit = await client.query<{ id: number }>(
		`INSERT INTO "publicationSyncJob" (
			"itemKey", "provider", "environment", "canonicalRevision", "reason",
			"idempotencyKey", "nextAttemptAt"
		) VALUES (
			'CRACTAAB', 'crossref', 'test', 2, 'provider_audit',
			'publication:crossref:test:CRACTAAB:2:audit:matched',
			'2030-08-12T23:01:00Z'
		) RETURNING "id"`,
	);
	const matchedAuditResult = await runCrossrefPublicationJobsOnce(
		database,
		auditConfig,
		{
			provider: successfulProvider(),
			workerId: "crossref-audit-worker",
			now: () => new Date("2030-08-12T23:01:00Z"),
		},
	);
	assert(
		matchedAuditResult.some(
			(outcome) =>
				outcome.jobId === Number(matchedAudit.rows[0]?.id) &&
				outcome.status === "audited",
		),
		"A matching Crossref audit did not finish with a real receipt",
	);
	const failedAudit = await client.query<{ id: number }>(
		`INSERT INTO "publicationSyncJob" (
			"itemKey", "provider", "environment", "canonicalRevision", "reason",
			"idempotencyKey", "nextAttemptAt"
		) VALUES (
			'CRACTAAB', 'crossref', 'test', 2, 'provider_audit',
			'publication:crossref:test:CRACTAAB:2:audit:failed',
			'2030-08-12T23:01:30Z'
		) RETURNING "id"`,
	);
	const failedAuditResult = await runCrossrefPublicationJobsOnce(
		database,
		auditConfig,
		{
			provider: {
				...successfulProvider(),
				verifyPublication: async () => {
					throw new Error("Crossref audit service unavailable");
				},
			},
			workerId: "crossref-failed-audit-worker",
			now: () => new Date("2030-08-12T23:01:30Z"),
		},
	);
	const failedAuditJob = await client.query<{
		attempts: number;
		lastError: string | null;
		processedAt: Date | null;
	}>(
		`SELECT "attempts", "lastError", "processedAt"
		 FROM "publicationSyncJob" WHERE "id" = $1`,
		[failedAudit.rows[0]?.id],
	);
	assert(
		failedAuditResult.some(
			(outcome) =>
				outcome.jobId === Number(failedAudit.rows[0]?.id) &&
				outcome.status === "retrying",
		) &&
			failedAuditJob.rows[0]?.attempts === 1 &&
			failedAuditJob.rows[0]?.processedAt === null &&
			failedAuditJob.rows[0]?.lastError?.includes(
				"Crossref audit service unavailable",
			),
		"A temporary Crossref audit failure was not kept for retry",
	);
	await client.query(
		`UPDATE "publicationSyncJob" SET "supersededAt" = '2030-08-12T23:01:31Z'
		 WHERE "id" = $1`,
		[failedAudit.rows[0]?.id],
	);
	const driftAudit = await client.query<{ id: number }>(
		`INSERT INTO "publicationSyncJob" (
			"itemKey", "provider", "environment", "canonicalRevision", "reason",
			"idempotencyKey", "nextAttemptAt"
		) VALUES (
			'CRACTAAB', 'crossref', 'test', 2, 'provider_audit',
			'publication:crossref:test:CRACTAAB:2:audit:drift',
			'2030-08-12T23:02:00Z'
		) RETURNING "id"`,
	);
	const driftAuditResult = await runCrossrefPublicationJobsOnce(
		database,
		auditConfig,
		{
			provider: {
				...successfulProvider(),
				verifyPublication: async () => ({
					status: "pending",
					reason: "Crossref title differs",
				}),
			},
			workerId: "crossref-drift-audit-worker",
			now: () => new Date("2030-08-12T23:02:00Z"),
		},
	);
	assert(
		driftAuditResult.some(
			(outcome) =>
				outcome.jobId === Number(driftAudit.rows[0]?.id) &&
				outcome.status === "drifted",
		),
		"Crossref remote drift was not detected",
	);
	const driftState = await client.query<{
		payloadHash: string | null;
		repairKey: string | null;
	}>(
		`SELECT
			pss."lastPayloadHash" AS "payloadHash",
			(
				SELECT psj."idempotencyKey" FROM "publicationSyncJob" psj
				WHERE psj."itemKey" = pss."itemKey"
					AND psj."reason" = 'nightly_reconciliation'
					AND psj."supersededAt" IS NULL
				ORDER BY psj."id" DESC LIMIT 1
			) AS "repairKey"
		 FROM "publicationSyncState" pss
		 WHERE pss."itemKey" = 'CRACTAAB' AND pss."provider" = 'crossref'`,
	);
	assert(
		driftState.rows[0]?.payloadHash === null &&
			driftState.rows[0]?.repairKey?.endsWith(
				`audit:${driftAudit.rows[0]?.id}`,
			),
		"Crossref drift did not clear the saved payload and queue one repair",
	);
	await client.query(
		`UPDATE "publicationSyncState"
		 SET "lastPayloadHash" = $1, "lastPayloadSnapshot" = $2::jsonb
		 WHERE "itemKey" = 'CRACTAAB' AND "provider" = 'crossref'`,
		[baseline.payloadHash, JSON.stringify(baseline.payloadSnapshot)],
	);
	await client.query(
		`UPDATE "publicationSyncJob" SET "supersededAt" = '2030-08-12T23:03:00Z'
		 WHERE "itemKey" = 'CRACTAAB' AND "reason" = 'nightly_reconciliation'
			AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL`,
	);

	await seedItem(client, { key: "CRACTAAE" });
	const pendingActivation = await activateCrossrefPublication(
		database,
		"CRACTAAE",
		config,
	);
	assert(
		pendingActivation.doi === "10.5555/library.000004",
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
	const retried = await retryCrossrefPublication(
		database,
		"CRACTAAF",
		config,
	);
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

	await client.query(
		`UPDATE "publicationSyncJob"
		 SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "supersededAt" = now()
		 WHERE "provider" = 'crossref' AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL`,
	);
	await seedItem(client, { key: "CRACTAAR" });
	await seedPublishedFile(client, "CRACTAAR", "CRPDFAAR");
	const wakeActivation = await activateCrossrefPublication(
		database,
		"CRACTAAR",
		config,
	);
	await client.query(
		`INSERT INTO "publicationTarget" ("itemKey", "provider", "environment", "identifierPolicy", "requestedBy")
		 VALUES ('CRACTAAR', 'zenodo', 'sandbox', 'reuse-crossref', 'crossref-wake-test')`,
	);
	const waitingJob = await database.transaction((transaction) =>
		savePublicationJob(transaction, {
			itemKey: "CRACTAAR",
			provider: "zenodo",
			environment: "sandbox",
			identifierPolicy: "reuse-crossref",
			canonicalRevision: wakeActivation.canonicalRevision,
			fileRevision: 1,
			reason: "manual_activation",
			now: new Date("2030-08-19T08:00:00Z"),
		}),
	);
	await client.query(
		`UPDATE "publicationSyncJob" SET "processedAt" = now(), "resultReceipt" = $2::jsonb WHERE id = $1`,
		[
			waitingJob.id,
			JSON.stringify({ status: "waiting", waitingOn: "crossref" }),
		],
	);
	const wakeOutcomes = await runCrossrefPublicationJobsOnce(
		database,
		config,
		{
			provider: successfulProvider(),
			workerId: "crossref-wake-worker",
			now: () => new Date("2030-08-19T09:00:00Z"),
		},
	);
	assert(
		wakeOutcomes.some(
			(outcome) =>
				outcome.jobId === wakeActivation.job.id &&
				outcome.status === "succeeded",
		),
		"Crossref verification did not finish for the Zenodo wake fixture",
	);
	const zenodoWakeJobs = await client.query<{
		canonicalRevision: number;
		fileRevision: number | null;
		reason: string;
	}>(
		`SELECT "canonicalRevision", "fileRevision", "reason"
		 FROM "publicationSyncJob"
		 WHERE "itemKey" = 'CRACTAAR' AND "provider" = 'zenodo' AND "supersededAt" IS NULL AND "processedAt" IS NULL`,
	);
	assert(
		zenodoWakeJobs.rows.length === 1 &&
			zenodoWakeJobs.rows[0]?.reason === "crossref_verified" &&
			Number(zenodoWakeJobs.rows[0].canonicalRevision) ===
				wakeActivation.canonicalRevision &&
			Number(zenodoWakeJobs.rows[0].fileRevision) === 1,
		"Verified Crossref DOI did not wake the ready reuse-Crossref Zenodo target",
	);

	await client.query(
		`UPDATE "publicationSyncJob"
		 SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "supersededAt" = now()
		 WHERE "provider" = 'crossref' AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL`,
	);
	await seedItem(client, { key: "CRACTAAT" });
	await seedPublishedFile(client, "CRACTAAT", "CRPDFAAT");
	const dualActivation = await activateCrossrefPublication(
		database,
		"CRACTAAT",
		config,
	);
	const dualInitial = await runCrossrefPublicationJobsOnce(database, config, {
		provider: successfulProvider(),
		workerId: "crossref-dual-initial-worker",
		now: () => new Date("2030-08-19T10:00:00Z"),
	});
	assert(
		dualInitial.some(
			(outcome) =>
				outcome.jobId === dualActivation.job.id &&
				outcome.status === "succeeded",
		),
		"The dual-provider fixture did not settle its initial Crossref deposit",
	);
	await client.query(
		`INSERT INTO "publicationTarget" (
			"itemKey", "provider", "environment", "identifierPolicy", "requestedBy"
		) VALUES (
			'CRACTAAT', 'zenodo', 'sandbox', 'mint-zenodo', 'crossref-isolation-test'
		)`,
	);
	await client.query(
		`INSERT INTO "publicationIdentifier" (
			"itemKey", "registrar", "environment", "role", "doi", "ownership",
			"lifecycle", "isCurrent", "reservedAt", "verifiedAt"
		) VALUES
			('CRACTAAT', 'zenodo', 'sandbox', 'version', '10.5072/zenodo.9001', 'managed', 'verified', true, now(), now()),
			('CRACTAAT', 'zenodo', 'sandbox', 'concept', '10.5072/zenodo.9000', 'managed', 'verified', true, now(), now())`,
	);
	await client.query(
		`INSERT INTO "publicationSyncState" (
			"itemKey", "provider", "environment", "identifierPolicy",
			"lastPayloadHash", "lastPayloadSnapshot", "lastFileManifestHash",
			"lastFileManifestSnapshot", "zenodoRecordId", "zenodoParentId",
			"zenodoVersionDoi", "zenodoConceptDoi"
		) VALUES (
			'CRACTAAT', 'zenodo', 'sandbox', 'mint-zenodo', $1, '{}'::jsonb,
			$2, '{}'::jsonb, '9001', '9000', '10.5072/zenodo.9001',
			'10.5072/zenodo.9000'
		)`,
		["a".repeat(64), "b".repeat(64)],
	);
	await client.query(
		`UPDATE "item"
		 SET "title" = 'Crossref edit while Zenodo is stale',
			"abstractNote" = 'A complete description for both publication providers.',
			"revision" = "revision" + 1
		 WHERE "key" = 'CRACTAAT'`,
	);
	await client.query(
		`UPDATE "publicationSyncState"
		 SET "lastFailureClass" = 'CROSSREF_WORKER_FAILED',
			"lastFailureSummary" = 'Earlier temporary Crossref failure',
			"consecutiveFailures" = 7
		 WHERE "itemKey" = 'CRACTAAT' AND "provider" = 'crossref'`,
	);
	const dualJob = await client.query<{ id: number }>(
		`INSERT INTO "publicationSyncJob" (
			"itemKey", "provider", "environment", "canonicalRevision", "reason",
			"idempotencyKey", "nextAttemptAt"
		) VALUES (
			'CRACTAAT', 'crossref', 'test', 3, 'record_changed',
			'publication:crossref:test:CRACTAAT:dual-provider-isolation',
			'2030-08-19T10:01:00Z'
		) RETURNING "id"`,
	);
	const dualUpdate = await runCrossrefPublicationJobsOnce(database, config, {
		provider: successfulProvider(),
		workerId: "crossref-dual-update-worker",
		now: () => new Date("2030-08-19T10:01:00Z"),
	});
	const dualJobState = await client.query<{
		consecutiveFailures: number;
		lastError: string | null;
		processedAt: Date | null;
	}>(
		`SELECT psj."lastError", psj."processedAt", pss."consecutiveFailures"
		 FROM "publicationSyncJob" psj
		 JOIN "publicationSyncState" pss
			ON pss."itemKey" = psj."itemKey"
			AND pss."provider" = psj."provider"
			AND pss."environment" = psj."environment"
		 WHERE psj."id" = $1`,
		[dualJob.rows[0]?.id],
	);
	assert(
		dualUpdate.some(
			(outcome) =>
				outcome.jobId === Number(dualJob.rows[0]?.id) &&
				outcome.status === "succeeded",
		) &&
			dualJobState.rows[0]?.processedAt != null &&
			dualJobState.rows[0]?.lastError === null &&
			dualJobState.rows[0]?.consecutiveFailures === 0,
		`The Crossref worker tried to execute stale Zenodo work from the shared plan: ${JSON.stringify({ dualUpdate, job: dualJobState.rows[0] })}`,
	);

	await seedItem(client, { key: "CRACTAAS" });
	const heartbeatConfig = {
		...config,
		services: {
			...config.services,
			publication: {
				...config.services.publication,
				worker: {
					...config.services.publication.worker,
					leaseSeconds: 1,
				},
			},
		},
	} as LibraryServerConfig;
	const heartbeatActivation = await activateCrossrefPublication(
		database,
		"CRACTAAS",
		heartbeatConfig,
	);
	const heartbeatOutcomes = await runCrossrefPublicationJobsOnce(
		database,
		heartbeatConfig,
		{
			heartbeatIntervalMs: 200,
			provider: slowSuccessfulProvider(),
			workerId: "crossref-heartbeat-worker",
		},
	);
	assert(
		heartbeatOutcomes.some(
			(outcome) =>
				outcome.jobId === heartbeatActivation.job.id &&
				outcome.status === "succeeded",
		),
		"A slow Crossref request lost its renewable publication lease",
	);
}

async function verifyDraftReservation(database: Database, client: Client) {
	const draft = await createNativeItemDraft(database, {
		itemType: "Report",
		licence: { kind: "zenodo", id: "cc-by-4.0" },
		title: "Draft DOI reservation",
		date: "2026-09-08",
		institution: "OpenDevEd",
		creators: [
			{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
		],
	});
	await setItemPublishingChoice(database, draft.itemKey, {
		route: "crossref-zenodo",
		identifierPolicy: "reuse-crossref",
	}, config);
	const reservations = await Promise.all(
		Array.from({ length: 4 }, () =>
			reserveCrossrefDoi(database, draft.itemKey, config, "creator"),
		),
	);
	assert(
		reservations.every((value) => value.doi === reservations[0].doi),
		"Concurrent reservation allocated different DOIs",
	);
	const before = await client.query(
		`SELECT (SELECT count(*) FROM "item" WHERE key = $1)::int AS records, (SELECT count(*) FROM "publicationSyncJob" WHERE "itemKey" = $1)::int AS jobs, (SELECT "activatedAt" FROM "publicationTarget" WHERE "itemKey" = $1 AND provider = 'crossref') AS activated`,
		[draft.itemKey],
	);
	assert.deepEqual(
		before.rows[0],
		{ records: 0, jobs: 0, activated: null },
		"Reserving a draft enabled publication work",
	);
	await publishItemDraft(database, draft.itemKey);
	const afterPublish = await client.query(
		`SELECT count(*)::int AS jobs FROM "publicationSyncJob" WHERE "itemKey" = $1`,
		[draft.itemKey],
	);
	assert(
		afterPublish.rows[0].jobs === 0,
		"Publishing metadata activated a reservation without approval",
	);
	const activation = await activateCrossrefPublication(
		database,
		draft.itemKey,
		config,
		"editor",
	);
	assert(
		activation.doi === reservations[0].doi,
		"Activation replaced the reserved DOI",
	);
	const activated = await client.query(
		`SELECT t."activatedAt", i."DOI", (SELECT count(*)::int FROM "publicationIdentifier" WHERE "itemKey" = $1) AS identifiers FROM "publicationTarget" t JOIN item i ON i.key = t."itemKey" WHERE t."itemKey" = $1 AND t.provider = 'crossref'`,
		[draft.itemKey],
	);
	assert(
		activated.rows[0].activatedAt &&
			activated.rows[0].DOI === reservations[0].doi &&
			activated.rows[0].identifiers === 1,
		"Activation did not enable the original identifier",
	);
	await seedItem(client, { key: "CRACTAAG", itemType: "Artwork" });
	const invalidActivation = await activateCrossrefPublication(
		database,
		"CRACTAAG",
		config,
	);
	assert(
		invalidActivation.job !== null,
		"Provider validation prevented saving the activation intent",
	);
	const invalidPlan = await buildCrossrefPlan(database, "CRACTAAG", config);
	assert(
		invalidPlan.plan.status === "needs_attention",
		"Unsupported Crossref metadata was allowed to publish",
	);
}

async function verifyIsolatedDatabase() {
	await withIsolatedPublicationDatabase(async (database, client) => {
		await verify(database, client);
		await verifyDraftReservation(database, client);
	});
}

describe("Crossref activation against an isolated database", () => {
	it("keeps activation, provider settlement, and retry durable", async () => {
		await verifyIsolatedDatabase();
	}, 120_000);
});

it("keeps production reservations and settlement separate from Test", async () => {
	await withIsolatedPublicationDatabase(async (database, client) => {
		const testDraft = await createNativeItemDraft(database, {
			itemType: "Report",
			licence: { kind: "zenodo", id: "cc-by-4.0" },
			title: "Test environment reservation",
		});
		await setItemPublishingChoice(database, testDraft.itemKey, {
			route: "crossref-zenodo",
			identifierPolicy: "reuse-crossref",
		}, config);
		await reserveCrossrefDoi(
			database,
			testDraft.itemKey,
			config,
			"creator",
		);

		const production = structuredClone(config);
		production.services.publication.crossref.environment = "production";
		const draft = await createNativeItemDraft(database, {
			itemType: "Report",
			licence: { kind: "zenodo", id: "cc-by-4.0" },
			title: "Production reservation",
			date: "2026-09-08",
			institution: "OpenDevEd",
			creators: [
				{
					creatorType: "author",
					firstName: "Ada",
					lastName: "Lovelace",
				},
			],
		});
		await setItemPublishingChoice(database, draft.itemKey, {
			route: "crossref-zenodo",
			identifierPolicy: "reuse-crossref",
		}, config);
		const reserved = await reserveCrossrefDoi(
			database,
			draft.itemKey,
			production,
			"creator",
		);
		const privateState = await client.query(
			`SELECT "environment", "lifecycle" FROM "publicationIdentifier" WHERE "itemKey" = $1`,
			[draft.itemKey],
		);
		assert.deepEqual(
			privateState.rows,
			[{ environment: "production", lifecycle: "reserved" }],
			"Production reservation was stored in Test",
		);
		await publishItemDraft(database, draft.itemKey);
		const activated = await activateCrossrefPublication(
			database,
			draft.itemKey,
			production,
			"editor",
		);
		assert.deepEqual(
			{ environment: activated.environment, doi: activated.doi },
			{ environment: "production", doi: reserved.doi },
			"Production activation changed the reservation",
		);
		const collisions = await client.query(
			`SELECT "itemKey" FROM "publicationIdentifier" WHERE "doi" = $1 AND "itemKey" <> $2`,
			[reserved.doi, draft.itemKey],
		);
		assert(
			collisions.rows.length === 0,
			"Production reused a DOI carried by another environment's record",
		);
		const provider = successfulProvider();
		const outcomes = await runCrossrefPublicationJobsOnce(
			database,
			production,
			{
				provider: {
					...provider,
					submitPublication: async (input) => {
						assert(
							input.environment === "production",
							"Crossref deposit used the test environment",
						);
						return provider.submitPublication(input);
					},
				},
			},
		);
		assert.deepEqual(
			outcomes.map((outcome) => outcome.status),
			["succeeded"],
			"Production job did not settle independently",
		);
		const verified = await client.query(
			`SELECT "environment", "lifecycle" FROM "publicationIdentifier" WHERE "itemKey" = $1`,
			[draft.itemKey],
		);
		assert.deepEqual(
			verified.rows,
			[{ environment: "production", lifecycle: "verified" }],
			"Production deposit did not verify the production DOI",
		);
	});
}, 120_000);
