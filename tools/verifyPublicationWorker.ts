import { createHash } from "node:crypto";

import type {
	CrossrefDepositor,
	ZenodoPreparedDraft,
	ZenodoWriter,
} from "@opendeved/doi-sync-core";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
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
				nightlyUtcTime: "23:59",
			},
		},
	},
	sources: [],
} as unknown as LibraryServerConfig;

async function seedRecord(client: Client) {
	await client.query(
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('PUBWRKAA', 'native', 'PUBWRKAA')`,
	);
	await client.query(
		`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision", "title", "abstractNote", "date", "creators", "publisher", "deleted")
		 VALUES ('PUBWRKAA', 'native', 'PUBWRKAA', 'Report', 1, 'Publication worker record', 'A complete description.', '2026-08-13', $1::jsonb, 'OpenDevEd', 0)`,
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
			"contentType", "sizeBytes", "sha256", "coverObjectPath", "coverPublicUrl",
			"coverWidth", "coverHeight", "pageCount", "publicationTags", "publishedAt"
		) VALUES (
			'PUBFILAA', 'native', 'PUBWRKAA', 1, 1,
			'private/PUBFILAA.pdf', 'private/PUBFILAA.png', 'public/PUBFILAA.pdf',
			'https://files.example.org/PUBFILAA.pdf', 'PUBFILAA.pdf', 'application/pdf',
			$1, $2, 'public/PUBFILAA.png', 'https://files.example.org/PUBFILAA.png',
			100, 140, 1, '[]'::jsonb, now()
		)`,
		[
			fileBytes.byteLength,
			createHash("sha256").update(fileBytes).digest("hex"),
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

function successfulZenodoProvider(): ZenodoWriter {
	const prepared = async (
		onPreparedDraft:
			| ((draft: ZenodoPreparedDraft) => Promise<void>)
			| undefined,
	) => {
		const draft = {
			depositionId: "7001",
			draftRecordId: "7001",
			parentId: "7000",
			payloadSnapshot: { title: "Publication worker record" },
		};
		await onPreparedDraft?.(draft);
		return draft;
	};
	return {
		findRecordByDoi: async () => ({ status: "not_found" }),
		deleteUnpublishedDraft: async () => undefined,
		discardPreparedDraft: async () => undefined,
		prepareCreateRecord: async (request) =>
			prepared(request.onPreparedDraft),
		prepareUpdateRecordMetadata: async (request) =>
			prepared(request.onPreparedDraft),
		prepareUpdateRecordFiles: async (request) =>
			prepared(request.onPreparedDraft),
		prepareNewVersion: async (request) =>
			prepared(request.onPreparedDraft),
		publishDraft: async ({ draft }) => ({
			latestRecordId: draft.draftRecordId,
			parentId: draft.parentId ?? draft.draftRecordId,
			versionDoi: `10.5072/zenodo.${draft.draftRecordId}`,
			conceptDoi: `10.5072/zenodo.${draft.parentId ?? draft.draftRecordId}`,
			links: {},
		}),
	};
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
		zenodo.state === "waiting_for_crossref" && zenodo.job === null,
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
	}>(`SELECT
		(SELECT count(*) FROM "publicationSyncJob" WHERE "itemKey" = 'PUBWRKAA' AND "processedAt" IS NOT NULL)::text AS "processedJobs",
		(SELECT count(*) FROM "publicationIdentifier" WHERE "itemKey" = 'PUBWRKAA' AND "lifecycle" = 'verified')::text AS "verifiedIdentifiers",
		(SELECT count(*) FROM "publicationSyncState" WHERE "itemKey" = 'PUBWRKAA' AND "provider" = 'crossref' AND "lastPayloadHash" IS NOT NULL)::text AS "crossrefState",
		(SELECT count(*) FROM "publicationSyncState" WHERE "itemKey" = 'PUBWRKAA' AND "provider" = 'zenodo' AND "lastPayloadHash" IS NOT NULL)::text AS "zenodoState"`);
	assert(
		rows.rows[0]?.processedJobs === "2" &&
			rows.rows[0]?.verifiedIdentifiers === "3" &&
			rows.rows[0]?.crossrefState === "1" &&
			rows.rows[0]?.zenodoState === "1",
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

	const nightlyAt = new Date("2030-08-13T23:59:01.000Z");
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
		nightly.nightly === "succeeded" && nightly.outcomes.length === 0,
		"A converged nightly run created provider work",
	);
	assert(
		!(await publicationNightlyRunIsDue(database, config, nightlyAt)),
		"The nightly run stayed due after it completed",
	);
}

async function verifyIsolatedDatabase() {
	const sourceUrl = new URL(verifiedDatabaseUrl);
	const databaseName = `publication_worker_${process.pid}_${Date.now()}`;
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
		await verifyWorkerLease(database);
		await verifyWorkerCycle(database, client);
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

describe("publication worker against an isolated database", () => {
	it("runs one leased process and settles Crossref before Zenodo", async () => {
		await verifyIsolatedDatabase();
	}, 120_000);
});
