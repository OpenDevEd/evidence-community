import { createHash } from "node:crypto";

import type { ZenodoPreparedDraft, ZenodoWriter } from "@opendeved/doi-sync-core";
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
	activateZenodoPublication,
	retryZenodoPublication,
	ZenodoActivationValidationError,
	ZenodoIdentifierPolicyLockedError,
} from "../src/lib/publication/zenodo-activation-service";
import { runZenodoPublicationJobsOnce } from "../src/lib/publication/zenodo-adapter";
import { claimNextPublicationJob } from "../src/lib/publication/queue";

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
		`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision", "title", "abstractNote", "date", "creators", "publisher", "DOI", "deleted")
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

async function seedPublishedFile(
	client: Client,
	parentKey: string,
	fileKey: string,
	bytes?: Uint8Array,
) {
	const size = bytes?.byteLength ?? 12;
	const sha256 = bytes
		? createHash("sha256").update(bytes).digest("hex")
		: "a".repeat(64);
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
			'application/pdf', $8, $9, $10, $11,
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
			size,
			sha256,
			`public/${fileKey}.png`,
			`https://files.example.org/${fileKey}.png`,
		],
	);
}

function memoryStorage(files: ReadonlyMap<string, Uint8Array>) {
	return {
		downloadPublic: async (path: string) => {
			const bytes = files.get(path);
			if (!bytes) throw new Error(`Missing public object ${path}`);
			return bytes.slice();
		},
	} as unknown as EvidenceFileStorage;
}

let fakeZenodoRecordNumber = 1000;

function successfulZenodoProvider(input: { discardCount?: { value: number } } = {}): ZenodoWriter {
	const prepared = async (
		onPreparedDraft: ((draft: ZenodoPreparedDraft) => Promise<void>) | undefined,
	) => {
		fakeZenodoRecordNumber += 1;
		const draft = {
			depositionId: String(fakeZenodoRecordNumber),
			draftRecordId: String(fakeZenodoRecordNumber),
			parentId: String(fakeZenodoRecordNumber + 10_000),
			payloadSnapshot: { title: "Zenodo activation record" },
		};
		await onPreparedDraft?.(draft);
		return draft;
	};
	return {
		findRecordByDoi: async () => ({ status: "not_found" }),
		deleteUnpublishedDraft: async () => undefined,
		discardPreparedDraft: async () => {
			if (input.discardCount) input.discardCount.value += 1;
		},
		prepareCreateRecord: async (request) => prepared(request.onPreparedDraft),
		prepareUpdateRecordMetadata: async (request) =>
			prepared(request.onPreparedDraft),
		prepareUpdateRecordFiles: async (request) => prepared(request.onPreparedDraft),
		prepareNewVersion: async (request) => prepared(request.onPreparedDraft),
		publishDraft: async ({ draft }) => ({
			latestRecordId: draft.draftRecordId,
			parentId: draft.parentId ?? draft.draftRecordId,
			versionDoi: `10.5072/zenodo.${draft.draftRecordId}`,
			conceptDoi: `10.5072/zenodo.${draft.parentId ?? draft.draftRecordId}`,
			links: {},
		}),
	};
}

function failingAfterJournalProvider(): ZenodoWriter {
	const provider = successfulZenodoProvider();
	return {
		...provider,
		prepareCreateRecord: async (request) => {
			const draft = {
				depositionId: "2001",
				draftRecordId: "2001",
				parentId: "2000",
			};
			await request.onPreparedDraft?.(draft);
			throw new Error("Upload stopped after the draft was saved");
		},
	};
}

function publishTimeoutProvider(): ZenodoWriter {
	const provider = successfulZenodoProvider();
	return {
		...provider,
		publishDraft: async () => {
			throw new Error("Zenodo timed out after receiving the publish request");
		},
	};
}

function forbidPrepareProvider(): ZenodoWriter {
	const provider = successfulZenodoProvider();
	const unexpectedPrepare = async () => {
		throw new Error("Recovery prepared a second Zenodo draft");
	};
	return {
		...provider,
		prepareCreateRecord: unexpectedPrepare,
		prepareUpdateRecordMetadata: unexpectedPrepare,
		prepareUpdateRecordFiles: unexpectedPrepare,
		prepareNewVersion: unexpectedPrepare,
	};
}

function collisionProvider(doi: string): ZenodoWriter {
	const provider = successfulZenodoProvider();
	return {
		...provider,
		publishDraft: async ({ draft }) => ({
			latestRecordId: draft.draftRecordId,
			parentId: draft.parentId ?? draft.draftRecordId,
			versionDoi: doi,
			conceptDoi: `10.5072/zenodo.${draft.parentId ?? draft.draftRecordId}`,
			links: {},
		}),
	};
}

function metadataUpdateProvider(input: {
	latestRecordId: string;
	parentId: string;
	versionDoi: string;
	conceptDoi: string;
}): ZenodoWriter {
	const provider = successfulZenodoProvider();
	return {
		...provider,
		publishDraft: async () => ({ ...input, links: {} }),
	};
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

	await client.query(
		`UPDATE "publicationSyncJob"
		 SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "supersededAt" = now()
		 WHERE "provider" = 'zenodo' AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL`,
	);
	const publishedBytes = new TextEncoder().encode("verified Zenodo PDF bytes");
	await seedParent(client, { key: "ZENWRKAA" });
	await seedPublishedFile(client, "ZENWRKAA", "ZENPDFWA", publishedBytes);
	const workerActivation = await activateZenodoPublication(
		database,
		"ZENWRKAA",
		config,
		"mint-zenodo",
	);
	const workerOutcomes = await runZenodoPublicationJobsOnce(
		database,
		config,
		memoryStorage(new Map([["public/ZENPDFWA.pdf", publishedBytes]])),
		{
			provider: successfulZenodoProvider(),
			workerId: "zenodo-success-worker",
			now: () => new Date("2030-08-13T10:00:00Z"),
		},
	);
	assert(
		workerOutcomes.some(
			(outcome) =>
				outcome.jobId === workerActivation.job?.id &&
				outcome.status === "succeeded",
		),
		"The fake Zenodo provider did not publish the queued record",
	);
	const publishedState = await client.query<{
		conceptDoi: string | null;
		fileManifestHash: string | null;
		journalStatus: string | null;
		parentId: string | null;
		processedAt: Date | null;
		recordId: string | null;
		searchEvents: string;
		versionDoi: string | null;
	}>(
		`SELECT
			pss."zenodoConceptDoi" AS "conceptDoi",
			pss."zenodoVersionDoi" AS "versionDoi",
			pss."zenodoRecordId" AS "recordId",
			pss."zenodoParentId" AS "parentId",
			pss."lastFileManifestHash" AS "fileManifestHash",
			psj."processedAt",
			zpj."status" AS "journalStatus",
			(SELECT count(*) FROM "outbox" WHERE "entityType" = 'item' AND "entityKey" = 'ZENWRKAA')::text AS "searchEvents"
		 FROM "publicationSyncState" pss
		 JOIN "publicationSyncJob" psj ON psj."itemKey" = pss."itemKey" AND psj."provider" = pss."provider"
		 LEFT JOIN "zenodoPublishJournal" zpj ON zpj."itemKey" = pss."itemKey"
		 WHERE pss."itemKey" = 'ZENWRKAA' AND pss."provider" = 'zenodo'`,
	);
	assert(
		publishedState.rows[0]?.versionDoi?.startsWith("10.5072/zenodo.") &&
			publishedState.rows[0]?.conceptDoi?.startsWith("10.5072/zenodo.") &&
			publishedState.rows[0]?.journalStatus === "published" &&
			publishedState.rows[0]?.processedAt != null &&
			Number(publishedState.rows[0]?.searchEvents ?? 0) > 0,
		"Zenodo publication did not settle identifiers, journal, job, and search together",
	);
	const managedIdentifiers = await client.query<{ role: string }>(
		`SELECT "role" FROM "publicationIdentifier"
		 WHERE "itemKey" = 'ZENWRKAA' AND "registrar" = 'zenodo' AND "isCurrent" = true
		 ORDER BY "role"`,
	);
	assert(
		managedIdentifiers.rows.map(({ role }) => role).join(",") ===
			"concept,version",
		"Zenodo identifiers were not normalized into the publication table",
	);
	const firstPublished = publishedState.rows[0];
	assert(
		firstPublished?.recordId &&
			firstPublished.parentId &&
			firstPublished.versionDoi &&
			firstPublished.conceptDoi &&
			firstPublished.fileManifestHash,
		"The published Zenodo fixture is incomplete",
	);
	await client.query(
		`UPDATE "item" SET "title" = 'Updated Zenodo metadata', "revision" = "revision" + 1 WHERE "key" = 'ZENWRKAA'`,
	);
	const metadataActivation = await activateZenodoPublication(
		database,
		"ZENWRKAA",
		config,
		"mint-zenodo",
	);
	const metadataUpdate = await runZenodoPublicationJobsOnce(
		database,
		config,
		memoryStorage(new Map([["public/ZENPDFWA.pdf", publishedBytes]])),
		{
			provider: metadataUpdateProvider({
				latestRecordId: firstPublished.recordId,
				parentId: firstPublished.parentId,
				versionDoi: firstPublished.versionDoi,
				conceptDoi: firstPublished.conceptDoi,
			}),
			workerId: "zenodo-metadata-worker",
			now: () => new Date("2030-08-13T10:30:00Z"),
		},
	);
	assert(
		metadataUpdate.some(
			(outcome) =>
				outcome.jobId === metadataActivation.job?.id &&
				outcome.status === "succeeded",
		),
		"Zenodo metadata update did not finish",
	);
	const preservedFileState = await client.query<{
		fileManifestHash: string | null;
		fileManifestSnapshot: unknown;
	}>(
		`SELECT
			"lastFileManifestHash" AS "fileManifestHash",
			"lastFileManifestSnapshot" AS "fileManifestSnapshot"
		 FROM "publicationSyncState" WHERE "itemKey" = 'ZENWRKAA' AND "provider" = 'zenodo'`,
	);
	assert(
		preservedFileState.rows[0]?.fileManifestHash ===
			firstPublished.fileManifestHash &&
			preservedFileState.rows[0]?.fileManifestSnapshot != null,
		"A metadata-only Zenodo update erased the settled file state",
	);

	const recoveryBytes = new TextEncoder().encode("recoverable Zenodo PDF bytes");
	await seedParent(client, { key: "ZENWRKAB" });
	await seedPublishedFile(client, "ZENWRKAB", "ZENPDFWB", recoveryBytes);
	const recoveryActivation = await activateZenodoPublication(
		database,
		"ZENWRKAB",
		config,
		"mint-zenodo",
	);
	let recoveryTime = new Date("2030-08-13T11:00:00Z");
	const recoveryStorage = memoryStorage(
		new Map([["public/ZENPDFWB.pdf", recoveryBytes]]),
	);
	const recoveryConfig = {
		...config,
		services: {
			...config.services,
			publication: {
				...config.services.publication,
				worker: { ...config.services.publication.worker, batchSize: 1 },
			},
		},
	} as LibraryServerConfig;
	const interrupted = await runZenodoPublicationJobsOnce(
		database,
		recoveryConfig,
		recoveryStorage,
		{
			provider: failingAfterJournalProvider(),
			workerId: "zenodo-recovery-worker",
			now: () => recoveryTime,
		},
	);
	assert(
		interrupted.some(
			(outcome) =>
				outcome.jobId === recoveryActivation.job?.id &&
				outcome.status === "retrying",
		),
		"A prepared Zenodo draft failure was not saved for retry",
	);
	const preparingJournal = await client.query<{ status: string }>(
		`SELECT "status" FROM "zenodoPublishJournal" WHERE "itemKey" = 'ZENWRKAB'`,
	);
	assert(
		preparingJournal.rows[0]?.status === "preparing",
		"The interrupted Zenodo draft was not journaled before failure",
	);
	recoveryTime = new Date(recoveryTime.getTime() + 61_000);
	const discardCount = { value: 0 };
	const recovered = await runZenodoPublicationJobsOnce(
		database,
		recoveryConfig,
		recoveryStorage,
		{
			provider: successfulZenodoProvider({ discardCount }),
			workerId: "zenodo-recovery-worker",
			now: () => recoveryTime,
		},
	);
	assert(
		recovered.some(
			(outcome) =>
				outcome.jobId === recoveryActivation.job?.id &&
				outcome.status === "recovered",
		) && discardCount.value === 1,
		"The interrupted Zenodo draft was not discarded before retry",
	);
	const journalAfterDiscard = await client.query(
		`SELECT 1 FROM "zenodoPublishJournal" WHERE "itemKey" = 'ZENWRKAB'`,
	);
	assert(
		journalAfterDiscard.rowCount === 0,
		"The discarded Zenodo journal was not cleared",
	);
	const resumed = await runZenodoPublicationJobsOnce(
		database,
		recoveryConfig,
		recoveryStorage,
		{
			provider: successfulZenodoProvider(),
			workerId: "zenodo-recovery-worker",
			now: () => recoveryTime,
		},
	);
	const resumedJob = await client.query<{ lastError: string | null }>(
		`SELECT "lastError" FROM "publicationSyncJob" WHERE "id" = $1`,
		[recoveryActivation.job?.id],
	);
	assert(
		resumed.some(
			(outcome) =>
				outcome.jobId === recoveryActivation.job?.id &&
				outcome.status === "succeeded",
		),
		`Zenodo publication did not resume after draft cleanup: ${JSON.stringify(resumed)} ${resumedJob.rows[0]?.lastError ?? ""}`,
	);

	const timeoutBytes = new TextEncoder().encode("publish timeout PDF bytes");
	await seedParent(client, { key: "ZENWRKAC" });
	await seedPublishedFile(client, "ZENWRKAC", "ZENPDFWC", timeoutBytes);
	const timeoutActivation = await activateZenodoPublication(
		database,
		"ZENWRKAC",
		config,
		"mint-zenodo",
	);
	const timeoutStorage = memoryStorage(
		new Map([["public/ZENPDFWC.pdf", timeoutBytes]]),
	);
	const timedOut = await runZenodoPublicationJobsOnce(
		database,
		recoveryConfig,
		timeoutStorage,
		{
			provider: publishTimeoutProvider(),
			workerId: "zenodo-timeout-worker",
			now: () => recoveryTime,
		},
	);
	assert(
		timedOut.some(
			(outcome) =>
				outcome.jobId === timeoutActivation.job?.id &&
				outcome.status === "retrying",
		),
		"A publish timeout was not saved for retry",
	);
	const readyJournal = await client.query<{
		fileManifestSnapshot: unknown;
		payloadSnapshot: unknown;
		status: string;
	}>(
		`SELECT "status", "payloadSnapshot", "fileManifestSnapshot"
		 FROM "zenodoPublishJournal" WHERE "itemKey" = 'ZENWRKAC'`,
	);
	assert(
		readyJournal.rows[0]?.status === "ready_to_publish" &&
			readyJournal.rows[0]?.payloadSnapshot != null &&
			readyJournal.rows[0]?.fileManifestSnapshot != null,
		"The publish-timeout journal did not retain exact payload snapshots",
	);
	await client.query(
		`UPDATE "item" SET "title" = 'Changed after Zenodo accepted the draft', "revision" = "revision" + 1 WHERE "key" = 'ZENWRKAC'`,
	);
	recoveryTime = new Date(recoveryTime.getTime() + 61_000);
	const timeoutRecovered = await runZenodoPublicationJobsOnce(
		database,
		recoveryConfig,
		timeoutStorage,
		{
			provider: forbidPrepareProvider(),
			workerId: "zenodo-timeout-worker",
			now: () => recoveryTime,
		},
	);
	assert(
		timeoutRecovered.some(
			(outcome) =>
				outcome.jobId === timeoutActivation.job?.id &&
				outcome.status === "succeeded",
		),
		"The ready Zenodo draft was not republished without creating another draft",
	);
	const timeoutState = await client.query<{
		fileManifestHash: string | null;
		fileManifestSnapshot: unknown;
		payloadHash: string | null;
		payloadSnapshot: unknown;
	}>(
		`SELECT
			"lastPayloadHash" AS "payloadHash",
			"lastPayloadSnapshot" AS "payloadSnapshot",
			"lastFileManifestHash" AS "fileManifestHash",
			"lastFileManifestSnapshot" AS "fileManifestSnapshot"
		 FROM "publicationSyncState" WHERE "itemKey" = 'ZENWRKAC' AND "provider" = 'zenodo'`,
	);
	assert(
		timeoutState.rows[0]?.payloadHash != null &&
			timeoutState.rows[0]?.payloadSnapshot != null &&
			timeoutState.rows[0]?.fileManifestHash != null &&
			timeoutState.rows[0]?.fileManifestSnapshot != null,
		"Publish-timeout recovery lost the exact successful Zenodo state",
	);

	const preplanBytes = new TextEncoder().encode("preplan failure PDF bytes");
	await seedParent(client, { key: "ZENWRKAD" });
	await seedPublishedFile(client, "ZENWRKAD", "ZENPDFWD", preplanBytes);
	const preplanActivation = await activateZenodoPublication(
		database,
		"ZENWRKAD",
		config,
		"mint-zenodo",
	);
	await client.query(`UPDATE "item" SET "deleted" = 1 WHERE "key" = 'ZENWRKAD'`);
	const preplanConfig = {
		...recoveryConfig,
		services: {
			...recoveryConfig.services,
			publication: {
				...recoveryConfig.services.publication,
				worker: { ...recoveryConfig.services.publication.worker, retryLimit: 1 },
			},
		},
	} as LibraryServerConfig;
	const preplanFailure = await runZenodoPublicationJobsOnce(
		database,
		preplanConfig,
		memoryStorage(new Map([["public/ZENPDFWD.pdf", preplanBytes]])),
		{
			provider: successfulZenodoProvider(),
			workerId: "zenodo-preplan-worker",
			now: () => recoveryTime,
		},
	);
	assert(
		preplanFailure.some(
			(outcome) =>
				outcome.jobId === preplanActivation.job?.id &&
				outcome.status === "failed",
		),
		"A first-run planning failure did not dead-letter cleanly",
	);
	const preplanJob = await client.query<{
		deadLetteredAt: Date | null;
		failureClass: string | null;
	}>(
		`SELECT psj."deadLetteredAt", pss."lastFailureClass" AS "failureClass"
		 FROM "publicationSyncJob" psj
		 JOIN "publicationSyncState" pss ON pss."itemKey" = psj."itemKey" AND pss."provider" = psj."provider"
		 WHERE psj."id" = $1`,
		[preplanActivation.job?.id],
	);
	assert(
		preplanJob.rows[0]?.deadLetteredAt != null &&
			preplanJob.rows[0]?.failureClass != null,
		"A first-run planning failure left no durable failure state",
	);

	const collisionBytes = new TextEncoder().encode("collision PDF bytes");
	await seedParent(client, { key: "ZENWRKAE" });
	await seedPublishedFile(client, "ZENWRKAE", "ZENPDFWE", collisionBytes);
	const collisionActivation = await activateZenodoPublication(
		database,
		"ZENWRKAE",
		config,
		"mint-zenodo",
	);
	const existingVersionDoi = publishedState.rows[0]?.versionDoi;
	assert(existingVersionDoi, "The collision fixture has no existing Zenodo DOI");
	const collisionResult = await runZenodoPublicationJobsOnce(
		database,
		recoveryConfig,
		memoryStorage(new Map([["public/ZENPDFWE.pdf", collisionBytes]])),
		{
			provider: collisionProvider(existingVersionDoi),
			workerId: "zenodo-collision-worker",
			now: () => recoveryTime,
		},
	);
	assert(
		collisionResult.some(
			(outcome) =>
				outcome.jobId === collisionActivation.job?.id &&
				outcome.status === "retrying",
		),
		"A locally owned Zenodo DOI collision was not rejected",
	);
	const collisionOwner = await client.query<{ itemKey: string }>(
		`SELECT "itemKey" FROM "publicationIdentifier"
		 WHERE "registrar" = 'zenodo' AND "environment" = 'sandbox' AND "doi" = $1`,
		[existingVersionDoi],
	);
	assert(
		collisionOwner.rows[0]?.itemKey === "ZENWRKAA",
		"A Zenodo DOI collision reassigned another record's identifier",
	);

	await client.query(
		`UPDATE "publicationSyncJob"
		 SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "supersededAt" = now()
		 WHERE "provider" = 'zenodo' AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL`,
	);
	for (const [parentKey, fileKey] of [
		["ZENWRKAF", "ZENPDFWF"],
		["ZENWRKAG", "ZENPDFWG"],
	] as const) {
		const bytes = new TextEncoder().encode(`concurrent claim ${parentKey}`);
		await seedParent(client, { key: parentKey });
		await seedPublishedFile(client, parentKey, fileKey, bytes);
		await activateZenodoPublication(
			database,
			parentKey,
			config,
			"mint-zenodo",
		);
	}
	const claimTime = new Date("2030-08-13T12:00:00Z");
	const [firstClaim, secondClaim] = await Promise.all([
		claimNextPublicationJob(database, {
			provider: "zenodo",
			environment: "sandbox",
			workerId: "parallel-worker-one",
			leaseSeconds: 900,
			claimedAt: claimTime,
		}),
		claimNextPublicationJob(database, {
			provider: "zenodo",
			environment: "sandbox",
			workerId: "parallel-worker-two",
			leaseSeconds: 900,
			claimedAt: claimTime,
		}),
	]);
	assert(
		firstClaim && secondClaim && firstClaim.id !== secondClaim.id,
		"Concurrent workers did not move past the locked head job",
	);
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
