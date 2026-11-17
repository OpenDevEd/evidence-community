import { successfulZenodoTestProvider } from "../tests/fixtures/zenodo-draft";
import assert from "node:assert/strict";
import { publicationTestConfig } from "../tests/fixtures/publication-config";
import { createHash } from "node:crypto";

import type {
	CrossrefDepositor,
} from "@opendeved/doi-sync-core";
import {
	buildPublicationFileManifestHash,
} from "@opendeved/doi-sync-core";
import type { Client } from "pg";
import { withIsolatedPublicationDatabase } from "../tests/helpers/isolated-publication-database";
import { describe, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LibraryServerConfig } from "../src/config/library-config/schema";
import type { Database } from "../src/db/database-schema";
import { schema } from "../src/db/database-schema";
import type { EvidenceFileStorage } from "../src/lib/admin/file-storage";
import {
	adminPublicationWorkerOverviewSchema,
} from "../src/lib/admin/publication-worker-contract";
import { getAdminPublicationWorkerOverview } from "../src/lib/admin/publication-worker-service";
import { activateCrossrefPublication } from "../src/lib/publication/crossref-activation-service";
import {
	runZenodoPublicationJobsOnce,
	type ZenodoPublicationProvider,
} from "../src/lib/publication/zenodo-adapter";
import {
	publicationNightlyRunIsDue,
	runPublicationWorkerCycle,
} from "../src/lib/publication/worker";
import {
	getPublicationWorkerRun,
	PublicationWorkerAlreadyRunningError,
	PublicationWorkerOwnershipLostError,
	publicationWorkerIsReady,
	registerPublicationWorker,
	stopPublicationWorker,
	updatePublicationWorker,
} from "../src/lib/publication/worker-state";
import { activateZenodoPublication } from "../src/lib/publication/zenodo-activation-service";
import { enqueuePublicationJobsForItem } from "../src/lib/publication/queue";
import { buildPublicationFileManifest } from "../src/lib/publication/record-adapter";
import { readPublicationRepositorySnapshot } from "../src/lib/publication/repository";
import { providerState } from "../src/lib/publication/state-adapter";


const config = publicationTestConfig({nightlyUtcTime: "23:59"});

async function seedRecord(client: Client) {
	await client.query(
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('PUBWRKAA', 'native', 'PUBWRKAA')`,
	);
	await client.query(
		`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision", "title", "abstractNote", "date", "creators", "publisher", "deleted", "licence")
		 VALUES ('PUBWRKAA', 'native', 'PUBWRKAA', 'Report', 1, 'Publication worker record', 'A complete description.', '2026-08-13', $1::jsonb, 'OpenDevEd', 0, '{"kind":"zenodo","id":"cc-by-4.0"}'::jsonb)`,
		[
			JSON.stringify([
				{
					creatorType: "author",
					firstName: "Ada",
					lastName: "Lovelace",
				},
			]),
		],
	);
	const fileBytes = new TextEncoder().encode("worker pdf fixture");
	await client.query(
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('PUBFILAA', 'native', 'PUBFILAA')`,
	);
	await client.query(
		`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "parentItem", "revision", "title", "deleted")
		 VALUES ('PUBFILAA', 'native', 'PUBFILAA', 'Attachment', 'PUBWRKAA', 1, 'Published PDF', 0)`,
	);
	await client.query(
		`INSERT INTO "itemFilePublication" (
			"itemKey", "sourceConnectionKey", "parentItemKey", "uploadRevision", "revision",
			"sourceObjectPath", "sourceCoverObjectPath", "objectPath", "publicUrl", "filename",
			"contentType", "sizeBytes", "sha256", "md5", "coverObjectPath", "coverPublicUrl",
			"coverWidth", "coverHeight", "pageCount", "publicationTags", "publishedAt"
		) VALUES (
			'PUBFILAA', 'native', 'PUBWRKAA', 1, 1,
			'private/PUBFILAA.pdf', 'private/PUBFILAA.png', 'public/PUBFILAA.pdf',
			'https://files.example.org/PUBFILAA.pdf', 'PUBFILAA.pdf', 'application/pdf',
			$1, $2, $3, 'public/PUBFILAA.png', 'https://files.example.org/PUBFILAA.png',
			100, 140, 1, '[]'::jsonb, now()
		)`,
		[
			fileBytes.byteLength,
			createHash("sha256").update(fileBytes).digest("hex"),
			createHash("md5").update(fileBytes).digest("hex"),
		],
	);
	return fileBytes;
}

function memoryStorage(fileBytes: Uint8Array) {
	return {
		downloadPublic: async (path: string) => {
			if (path !== "public/PUBFILAA.pdf") {
				throw new Error(`Unexpected public object ${path}`);
			}
			return fileBytes.slice();
		},
	} as unknown as EvidenceFileStorage;
}

function successfulCrossrefProvider(gate?: {
	started: () => void;
	release: Promise<void>;
}): CrossrefDepositor {
	return {
		submitPublication: async (input) => {
			await input.onSubmitted?.();
			gate?.started();
			await gate?.release;
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

function successfulZenodoProvider(
	publishedAt = new Date("2030-08-13T12:00:00.000Z"),
): ZenodoPublicationProvider {
 return successfulZenodoTestProvider(() => ({id: "7001", parentId: "7000"}), publishedAt);
}

async function verifyCrossrefBackedPdfCorrection(
	database: Database,
	client: Client,
) {
	const correctionBytes = new TextEncoder().encode(
		"worker pdf fixture with a minor correction",
	);
	const approvedAt = new Date("2030-08-20T12:00:00.000Z");
	await client.query(
		`UPDATE "itemFilePublication"
		 SET "uploadRevision" = 2,
			 "revision" = 2,
			 "sizeBytes" = $1,
			 "sha256" = $2,
			 "md5" = $3,
			 "publishedAt" = $4,
			 "updatedAt" = $4
		 WHERE "itemKey" = 'PUBFILAA'`,
		[
			correctionBytes.byteLength,
			createHash("sha256").update(correctionBytes).digest("hex"),
			createHash("md5").update(correctionBytes).digest("hex"),
			approvedAt,
		],
	);
	await client.query(
		`UPDATE "item" SET "revision" = 2, "updatedAt" = $1 WHERE "key" = 'PUBWRKAA'`,
		[approvedAt],
	);
	const snapshot = await readPublicationRepositorySnapshot(
		database,
		"PUBWRKAA",
		"test",
	);
	const fileManifestHash = buildPublicationFileManifestHash(
		buildPublicationFileManifest(snapshot.files),
	);
	const [identifier] = await client.query<{ doi: string }>(
		`SELECT "doi" FROM "publicationIdentifier"
		 WHERE "itemKey" = 'PUBWRKAA'
			 AND "registrar" = 'crossref'
			 AND "role" = 'primary'
			 AND "isCurrent" = true`,
	).then((result) => result.rows);
	assert(identifier, "The PDF correction had no active Crossref DOI");
	await client.query(
		`INSERT INTO "zenodoFileCorrectionApproval"
			("environment", "itemKey", "doi", "fileManifestHash", "approvedAt")
		 VALUES ('sandbox', 'PUBWRKAA', $1, $2, $3)`,
		[identifier.doi, fileManifestHash, approvedAt],
	);
	await database.transaction((transaction) =>
		enqueuePublicationJobsForItem(transaction, {
			itemKey: "PUBWRKAA",
			canonicalRevision: 2,
			reason: "file_changed",
			now: approvedAt,
			providers: ["zenodo"],
		}),
	);
	const outcomes = await runZenodoPublicationJobsOnce(
		database,
		config,
		memoryStorage(correctionBytes),
		{
			workerId: "publication-file-correction",
			now: () => approvedAt,
			provider: successfulZenodoProvider(
				new Date("2030-08-20T12:00:00.000Z"),
			),
		},
	);
	const [jobState] = await client.query<{
		lastError: string | null;
	}>(`SELECT "lastError" FROM "publicationSyncJob" WHERE "id" = $1`, [
		outcomes[0]?.jobId,
	]).then((result) => result.rows);
	assert(
		outcomes.length === 1 && outcomes[0]?.status === "succeeded",
		`The approved PDF correction did not finish: ${JSON.stringify(outcomes)} ${jobState?.lastError ?? ""}`,
	);
	const result = await client.query<{
		consumedAt: Date | null;
		fileCorrectionApprovalId: string | null;
		versionDoi: string | null;
		firstPublishedAt: Date | null;
	}>(`SELECT
		(SELECT "consumedAt" FROM "zenodoFileCorrectionApproval" WHERE "itemKey" = 'PUBWRKAA') AS "consumedAt",
		(SELECT "fileCorrectionApprovalId"::text FROM "zenodoPublishJournal" WHERE "itemKey" = 'PUBWRKAA' ORDER BY "updatedAt" DESC LIMIT 1) AS "fileCorrectionApprovalId",
		(SELECT "zenodoVersionDoi" FROM "publicationSyncState" WHERE "itemKey" = 'PUBWRKAA' AND "provider" = 'zenodo') AS "versionDoi",
		(SELECT "zenodoFirstPublishedAt" FROM "publicationSyncState" WHERE "itemKey" = 'PUBWRKAA' AND "provider" = 'zenodo') AS "firstPublishedAt"`);
	const saved = result.rows[0];
	assert(
		saved?.consumedAt?.toISOString() === approvedAt.toISOString() &&
			saved.fileCorrectionApprovalId !== null &&
			saved.versionDoi === "10.5072/zenodo.7001" &&
			saved.firstPublishedAt?.toISOString() ===
				"2030-08-13T12:00:00.000Z",
		"The worker did not consume the exact approval and preserve the original Zenodo version",
	);
	const savedApprovalId = saved.fileCorrectionApprovalId;
	const durableState = providerState(
		await readPublicationRepositorySnapshot(database, "PUBWRKAA", "test"),
		"zenodo",
		config.services.publication,
	);
	assert(
		durableState?.zenodo?.consumedFileCorrectionApprovalIds?.includes(
			savedApprovalId,
		) === true,
		"The consumed Zenodo PDF correction approval was not restored into worker state",
	);
}

async function verifyMismatchedPdfCorrectionApprovalIsBlocked(
	database: Database,
	client: Client,
) {
	const changedAt = new Date("2030-08-21T12:00:00.000Z");
	const mismatchedBytes = new TextEncoder().encode(
		"worker pdf fixture with a stale approval",
	);
	await client.query(
		`UPDATE "itemFilePublication"
		 SET "uploadRevision" = 3,
			 "revision" = 3,
			 "sizeBytes" = $1,
			 "sha256" = $2,
			 "md5" = $3,
			 "publishedAt" = $4,
			 "updatedAt" = $4
		 WHERE "itemKey" = 'PUBFILAA'`,
		[
			mismatchedBytes.byteLength,
			createHash("sha256").update(mismatchedBytes).digest("hex"),
			createHash("md5").update(mismatchedBytes).digest("hex"),
			changedAt,
		],
	);
	await client.query(
		`UPDATE "item" SET "revision" = 3, "updatedAt" = $1 WHERE "key" = 'PUBWRKAA'`,
		[changedAt],
	);
	await client.query(
		`INSERT INTO "zenodoFileCorrectionApproval"
			("environment", "itemKey", "doi", "fileManifestHash", "approvedAt")
		 VALUES ('sandbox', 'PUBWRKAA', '10.5555/library.000001', repeat('a', 64), $1)`,
		[changedAt],
	);
	await database.transaction((transaction) =>
		enqueuePublicationJobsForItem(transaction, {
			itemKey: "PUBWRKAA",
			canonicalRevision: 3,
			reason: "file_changed",
			now: changedAt,
			providers: ["zenodo"],
		}),
	);
	let providerCalls = 0;
	const provider = successfulZenodoProvider();
	const outcomes = await runZenodoPublicationJobsOnce(
		database,
		config,
		memoryStorage(mismatchedBytes),
		{
			workerId: "publication-unapproved-correction",
			now: () => changedAt,
			provider: {
				...provider,
				prepareUpdateRecordFiles: async (...args) => {
					providerCalls += 1;
					return provider.prepareUpdateRecordFiles(...args);
				},
			},
		},
	);
	const [job] = await client.query<{
		deadLetteredAt: Date | null;
		lastError: string | null;
	}>(`SELECT "deadLetteredAt", "lastError"
		FROM "publicationSyncJob"
		WHERE "itemKey" = 'PUBWRKAA' AND "canonicalRevision" = 3 AND "provider" = 'zenodo'`,
	).then((result) => result.rows);
	assert(
		outcomes.length === 1 &&
			outcomes[0]?.status === "failed" &&
			providerCalls === 0 &&
			job?.deadLetteredAt?.toISOString() === changedAt.toISOString() &&
			job.lastError?.includes("ZENODO_FILE_CORRECTION_APPROVAL_REQUIRED") ===
				true,
		`A Crossref-backed PDF correction with the wrong approval hash was not stopped immediately: ${JSON.stringify({ outcomes, providerCalls, job })}`,
	);
}

async function verifyWorkerLease(database: Database) {
	const startedAt = new Date("2030-08-13T12:00:00.000Z");
	const first = await registerPublicationWorker(database, {
		workerId: "publication-worker",
		instanceId: "first-instance",
		registeredAt: startedAt,
		leaseSeconds: 30,
	});
	try {
		await registerPublicationWorker(database, {
			workerId: "publication-worker",
			instanceId: "blocked-instance",
			registeredAt: new Date(startedAt.getTime() + 1_000),
			leaseSeconds: 30,
		});
		throw new Error("A second live publication worker was registered");
	} catch (error) {
		if (!(error instanceof PublicationWorkerAlreadyRunningError)) throw error;
	}
	const heartbeatAt = new Date(startedAt.getTime() + 5_000);
	const progress = {
		workerId: "publication-worker",
		instanceId: "first-instance",
		stage: "idle" as const,
		currentProvider: null,
		lastCompletedAt: null,
		lastError: null,
	};
	const updated = await updatePublicationWorker(database, {
		runId: first.id,
		instanceId: "first-instance",
		heartbeatAt,
		leaseSeconds: 30,
		claimedJobs: 0,
		succeededJobs: 0,
		failedJobs: 0,
		progress,
	});
	assert(
		publicationWorkerIsReady(
			updated,
			new Date(heartbeatAt.getTime() + 1_000),
		),
		"A healthy publication worker was not ready",
	);
	await stopPublicationWorker(database, {
		runId: first.id,
		instanceId: "first-instance",
		stoppedAt: new Date(heartbeatAt.getTime() + 2_000),
		claimedJobs: 0,
		succeededJobs: 0,
		failedJobs: 0,
		progress: { ...progress, stage: "stopped" },
	});

	await registerPublicationWorker(database, {
		workerId: "publication-worker",
		instanceId: "expired-instance",
		registeredAt: new Date("2030-08-13T13:00:00.000Z"),
		leaseSeconds: 30,
	});
	const replacement = await registerPublicationWorker(database, {
		workerId: "publication-worker",
		instanceId: "replacement-instance",
		registeredAt: new Date("2030-08-13T13:00:31.000Z"),
		leaseSeconds: 30,
	});
	const expired = await getPublicationWorkerRun(
		database,
		"worker:expired-instance",
	);
	assert(
		expired?.status === "failed" && expired.failure?.includes("lease expired"),
		"An expired publication worker was not closed before takeover",
	);
	try {
		await updatePublicationWorker(database, {
			runId: "worker:expired-instance",
			instanceId: "expired-instance",
			heartbeatAt: new Date("2030-08-13T13:00:32.000Z"),
			leaseSeconds: 30,
			claimedJobs: 0,
			succeededJobs: 0,
			failedJobs: 0,
			progress: {
				...progress,
				instanceId: "expired-instance",
			},
		});
		throw new Error("An expired worker renewed after ownership changed");
	} catch (error) {
		if (!(error instanceof PublicationWorkerOwnershipLostError)) throw error;
	}
	await stopPublicationWorker(database, {
		runId: replacement.id,
		instanceId: "replacement-instance",
		stoppedAt: new Date("2030-08-13T13:00:32.000Z"),
		claimedJobs: 0,
		succeededJobs: 0,
		failedJobs: 0,
		progress: {
			workerId: "publication-worker",
			instanceId: "replacement-instance",
			stage: "stopped",
			currentProvider: null,
			lastCompletedAt: null,
			lastError: null,
		},
	});

	const retryConfig = {
		...config,
		services: {
			...config.services,
			publication: {
				...config.services.publication,
				worker: {
					...config.services.publication.worker,
					nightlyUtcTime: "02:00",
				},
			},
		},
	} as LibraryServerConfig;
	await database.insert(schema.publicationSyncRun).values({
		id: "nightly:failed-cooldown",
		trigger: "nightly",
		status: "failed",
		heartbeatAt: new Date("2030-08-13T14:00:00.000Z"),
		startedAt: new Date("2030-08-13T13:59:00.000Z"),
		completedAt: new Date("2030-08-13T14:00:00.000Z"),
		failure: "Error: broken nightly record",
	});
	assert(
		!(await publicationNightlyRunIsDue(
			database,
			retryConfig,
			new Date("2030-08-13T14:14:59.999Z"),
		)),
		"A failed nightly run retried before its cooldown ended",
	);
	assert(
		await publicationNightlyRunIsDue(
			database,
			retryConfig,
			new Date("2030-08-13T14:15:00.000Z"),
		),
		"A failed nightly run did not retry after its cooldown ended",
	);
}

async function verifyWorkerCycle(database: Database, client: Client) {
	const fileBytes = await seedRecord(client);
	const crossref = await activateCrossrefPublication(
		database,
		"PUBWRKAA",
		config,
	);
	const zenodo = await activateZenodoPublication(
		database,
		"PUBWRKAA",
		config,
		"reuse-crossref",
	);
	assert(crossref.job !== null, "Crossref activation did not create a job");
	assert(
		zenodo.state === "waiting_for_crossref" && zenodo.job !== null,
		"Zenodo did not wait for Crossref verification",
	);

	const now = new Date("2030-08-13T14:00:00.000Z");
	const run = await registerPublicationWorker(database, {
		workerId: "publication-cycle",
		instanceId: "cycle-instance",
		registeredAt: now,
		leaseSeconds: 30,
	});
	const progress = {
		workerId: "publication-cycle",
		instanceId: "cycle-instance",
		stage: "crossref" as const,
		currentProvider: "crossref" as const,
		lastCompletedAt: null,
		lastError: null,
	};
	await updatePublicationWorker(database, {
		runId: run.id,
		instanceId: "cycle-instance",
		heartbeatAt: now,
		leaseSeconds: 30,
		claimedJobs: 0,
		succeededJobs: 0,
		failedJobs: 0,
		progress,
	});
	let releaseCrossref!: () => void;
	const release = new Promise<void>((resolve) => {
		releaseCrossref = resolve;
	});
	let crossrefStarted!: () => void;
	const started = new Promise<void>((resolve) => {
		crossrefStarted = resolve;
	});
	const stages: string[] = [];
	const cyclePromise = runPublicationWorkerCycle(
		database,
		config,
		memoryStorage(fileBytes),
		{
			workerId: "publication-cycle",
			now: () => now,
			crossrefProvider: successfulCrossrefProvider({
				started: crossrefStarted,
				release,
			}),
			zenodoProvider: successfulZenodoProvider(),
			onStage: async (stage) => {
				stages.push(stage);
			},
		},
	);
	await started;
	const workingOverview = adminPublicationWorkerOverviewSchema.parse(
		await getAdminPublicationWorkerOverview(database, config, now),
	);
	assert(
		workingOverview.worker?.active === true &&
			workingOverview.worker.ready === true &&
			workingOverview.currentJob?.provider === "crossref" &&
			workingOverview.currentJob.itemKey === "PUBWRKAA" &&
			workingOverview.queue.hasPending,
		`The admin status did not report the live Crossref job: ${JSON.stringify(workingOverview)}`,
	);
	releaseCrossref();
	const cycle = await cyclePromise;
	assert(
		cycle.nightly === "not_due" &&
			cycle.outcomes.map(({ provider, status }) => `${provider}:${status}`).join(",") ===
				"crossref:succeeded,zenodo:succeeded",
		`The worker did not finish both providers in order: ${JSON.stringify(cycle)}`,
	);
	assert(
		stages.join(",") === "crossref,zenodo,idle",
		`The worker reported the wrong stages: ${stages.join(",")}`,
	);
	const rows = await client.query<{
		processedJobs: string;
		verifiedIdentifiers: string;
		crossrefState: string;
		zenodoState: string;
		zenodoFirstPublishedAt: Date | null;
	}>(`SELECT
		(SELECT count(*) FROM "publicationSyncJob" WHERE "itemKey" = 'PUBWRKAA' AND "processedAt" IS NOT NULL)::text AS "processedJobs",
		(SELECT count(*) FROM "publicationIdentifier" WHERE "itemKey" = 'PUBWRKAA' AND "lifecycle" = 'verified')::text AS "verifiedIdentifiers",
		(SELECT count(*) FROM "publicationSyncState" WHERE "itemKey" = 'PUBWRKAA' AND "provider" = 'crossref' AND "lastPayloadHash" IS NOT NULL)::text AS "crossrefState",
		(SELECT count(*) FROM "publicationSyncState" WHERE "itemKey" = 'PUBWRKAA' AND "provider" = 'zenodo' AND "lastPayloadHash" IS NOT NULL)::text AS "zenodoState",
		(SELECT "zenodoFirstPublishedAt" FROM "publicationSyncState" WHERE "itemKey" = 'PUBWRKAA' AND "provider" = 'zenodo') AS "zenodoFirstPublishedAt"`);
	assert(
		rows.rows[0]?.processedJobs === "2" &&
			rows.rows[0]?.verifiedIdentifiers === "3" &&
			rows.rows[0]?.crossrefState === "1" &&
			rows.rows[0]?.zenodoState === "1" &&
			rows.rows[0]?.zenodoFirstPublishedAt?.toISOString() ===
				"2030-08-13T12:00:00.000Z",
		"The worker did not save both provider results",
	);
	const completedAt = new Date(now.getTime() + 1_000);
	await updatePublicationWorker(database, {
		runId: run.id,
		instanceId: "cycle-instance",
		heartbeatAt: completedAt,
		leaseSeconds: 30,
		claimedJobs: 2,
		succeededJobs: 2,
		failedJobs: 0,
		progress: {
			...progress,
			stage: "idle",
			currentProvider: null,
			lastCompletedAt: completedAt.toISOString(),
		},
	});
	await stopPublicationWorker(database, {
		runId: run.id,
		instanceId: "cycle-instance",
		stoppedAt: new Date(now.getTime() + 2_000),
		claimedJobs: 2,
		succeededJobs: 2,
		failedJobs: 0,
		progress: {
			...progress,
			stage: "stopped",
			currentProvider: null,
			lastCompletedAt: completedAt.toISOString(),
		},
	});
	const completedOverview = adminPublicationWorkerOverviewSchema.parse(
		await getAdminPublicationWorkerOverview(
			database,
			config,
			new Date(now.getTime() + 3_000),
		),
	);
	assert(
		completedOverview.worker?.active === false &&
			completedOverview.worker.succeededJobs === 2 &&
			completedOverview.currentJob === null &&
			!completedOverview.queue.hasPending &&
			!completedOverview.queue.hasFailed,
		"The admin status did not report the completed worker state",
	);
	await verifyCrossrefBackedPdfCorrection(database, client);

	const nightlyAt = new Date("2030-08-20T23:59:01.000Z");
	assert(
		await publicationNightlyRunIsDue(database, config, nightlyAt),
		"The nightly run was not due after its UTC boundary",
	);
	const nightly = await runPublicationWorkerCycle(
		database,
		config,
		memoryStorage(fileBytes),
		{
			workerId: "publication-nightly",
			now: () => nightlyAt,
			crossrefProvider: successfulCrossrefProvider(),
			zenodoProvider: successfulZenodoProvider(),
		},
	);
	assert(
		nightly.nightly === "succeeded" &&
			nightly.outcomes
				.map(({ provider, status }) => `${provider}:${status}`)
				.join(",") === "crossref:audited,zenodo:audited",
		`A converged nightly run did not audit both providers: ${JSON.stringify(nightly)}`,
	);
	assert(
		!(await publicationNightlyRunIsDue(database, config, nightlyAt)),
		"The nightly run stayed due after it completed",
	);
	await verifyMismatchedPdfCorrectionApprovalIsBlocked(database, client);
}

async function verifyIsolatedDatabase() {
	await withIsolatedPublicationDatabase(async (database, client) => {
		await verifyWorkerLease(database);
		await verifyWorkerCycle(database, client);
	});
}

describe("publication worker against an isolated database", () => {
	it("runs one leased process and settles Crossref before Zenodo", async () => {
		await verifyIsolatedDatabase();
	}, 120_000);
});
