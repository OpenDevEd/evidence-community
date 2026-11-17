import { getAdminPublicationWorkerOverview } from "../src/lib/admin/publication-worker-service";
import { runNightlyPublicationReconciliation } from "../src/lib/publication/reconciler";
import { successfulZenodoTestProvider } from "../tests/fixtures/zenodo-draft";
import assert from "node:assert/strict";
import { publicationTestConfig } from "../tests/fixtures/publication-config";
import { createHash } from "node:crypto";

import type { ZenodoWriter } from "@opendeved/doi-sync-core";
import {} from "@opendeved/doi-sync-core";
import type { Client } from "pg";
import { withIsolatedPublicationDatabase } from "../tests/helpers/isolated-publication-database";
import { describe, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LibraryServerConfig } from "../src/config/library-config/schema";
import type { Database } from "../src/db/database-schema";
import type { EvidenceFileStorage } from "../src/lib/admin/file-storage";
import {
	activateZenodoPublication,
	retryZenodoPublication,
	ZenodoActivationValidationError,
	ZenodoIdentifierPolicyLockedError,
} from "../src/lib/publication/zenodo-activation-service";
import { buildCrossrefPlan } from "../src/lib/publication/crossref-adapter";
import {
	runZenodoPublicationJobsOnce,
	type ZenodoPublicationProvider,
} from "../src/lib/publication/zenodo-adapter";
import {
	claimNextPublicationJob,
	deferPublicationJob,
	finishPublicationJob,
	PublicationJobLeaseLostError,
} from "../src/lib/publication/queue";

const config = publicationTestConfig();

async function seedParent(
	client: Client,
	input: { key: string; doi?: string },
) {
	await client.query(
		`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'native', $1)`,
		[input.key],
	);
	await client.query(
		`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision", "title", "abstractNote", "date", "creators", "publisher", "DOI", "deleted", "licence")
		 VALUES ($1, 'native', $1, 'Report', 1, 'Zenodo activation record', 'A complete description.', '2026-08-13', $2::jsonb, 'OpenDevEd', $3, 0, '{"kind":"zenodo","id":"cc-by-4.0"}'::jsonb)`,
		[
			input.key,
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
	const md5 = bytes
		? createHash("md5").update(bytes).digest("hex")
		: "b".repeat(32);
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
			"contentType", "sizeBytes", "sha256", "md5", "coverObjectPath", "coverPublicUrl",
			"coverWidth", "coverHeight", "pageCount", "publicationTags", "publishedAt"
		) VALUES (
			$1, 'native', $2, 1, 1,
			$3, $4, $5, $6, $7,
			'application/pdf', $8, $9, $10, $11, $12,
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
			md5,
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

function successfulZenodoProvider(
	input: { discardCount?: { value: number } } = {},
): ZenodoPublicationProvider {
	return successfulZenodoTestProvider(
		() => {
			fakeZenodoRecordNumber += 1;
			return {
				id: String(fakeZenodoRecordNumber),
				parentId: String(fakeZenodoRecordNumber + 10_000),
			};
		},
		undefined,
		async () => {
			if (input.discardCount) input.discardCount.value += 1;
		},
	);
}

function failingAfterJournalProvider(): ZenodoPublicationProvider {
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

function publishTimeoutProvider(): ZenodoPublicationProvider {
	const provider = successfulZenodoProvider();
	return {
		...provider,
		publishDraft: async () => {
			throw new Error(
				"Zenodo timed out after receiving the publish request",
			);
		},
	};
}

function forbidPrepareProvider(): ZenodoPublicationProvider {
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

function collisionProvider(doi: string): ZenodoPublicationProvider {
	const provider = successfulZenodoProvider();
	return {
		...provider,
		publishDraft: async ({ draft }) => ({
			latestRecordId: draft.draftRecordId,
			parentId: draft.parentId ?? draft.draftRecordId,
			publishedAt: new Date("2030-08-13T12:00:00.000Z"),
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
}): ZenodoPublicationProvider {
	const provider = successfulZenodoProvider();
	return {
		...provider,
		publishDraft: async () => ({
			...input,
			publishedAt: new Date("2030-08-13T12:00:00.000Z"),
			links: {},
		}),
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
	assert(
		fileless.state === "waiting_for_file",
		"Fileless activation did not wait",
	);
	assert(
		fileless.job !== null,
		"Fileless activation did not queue draft creation",
	);
	const repeated = await activateZenodoPublication(
		database,
		"ZENACTAA",
		config,
		"mint-zenodo",
	);
	assert(
		repeated.job?.id === fileless.job.id,
		"Repeated activation duplicated the draft job",
	);
	const filelessRows = await client.query<{ targets: string; jobs: string }>(
		`SELECT
			(SELECT count(*) FROM "publicationTarget" WHERE "itemKey" = 'ZENACTAA')::text AS targets,
			(SELECT count(*) FROM "publicationSyncJob" WHERE "itemKey" = 'ZENACTAA')::text AS jobs`,
	);
	assert(
		filelessRows.rows[0]?.targets === "1" &&
			filelessRows.rows[0]?.jobs === "1",
		"Fileless activation was not idempotent",
	);

	await client.query(
		`UPDATE "item" SET "abstractNote" = NULL WHERE "key" = 'ZENACTAA'`,
	);
	await client.query(
		`INSERT INTO "publicationSyncState" ("itemKey", provider, environment, "identifierPolicy", "lastFailureClass", "lastFailureSummary", "consecutiveFailures") VALUES ('ZENACTAA', 'zenodo', 'sandbox', 'mint-zenodo', 'transient', 'Previous draft creation failed', 1)`,
	);
	let emptyDraftCalls = 0;
	const emptyProvider = successfulZenodoProvider();
	const emptyOutcomes = await runZenodoPublicationJobsOnce(
		database,
		config,
		memoryStorage(new Map()),
		{
			provider: {
				...emptyProvider,
				prepareEmptyDraft: async (request) => {
					emptyDraftCalls += 1;
					return emptyProvider.prepareEmptyDraft(request);
				},
				publishDraft: async () => {
					throw new Error("A fileless draft must not publish");
				},
			},
		},
	);
	assert(
		emptyOutcomes[0]?.status === "waiting" && emptyDraftCalls === 1,
		"Missing PDF and abstract prevented draft creation",
	);
	const draftState = await client.query<{
		draft: string;
		identifiers: string;
		failure: string | null;
	}>(
		`SELECT "lastFailureSummary" AS failure, "unpublishedDraftDepositionId" AS draft, (SELECT count(*)::text FROM "publicationIdentifier" WHERE "itemKey" = 'ZENACTAA') AS identifiers FROM "publicationSyncState" WHERE "itemKey" = 'ZENACTAA'`,
	);
	assert(
		draftState.rows[0]?.draft === "90001" &&
			draftState.rows[0]?.identifiers === "0",
		"Empty draft was not saved independently of registered identifiers",
	);
	assert(draftState.rows[0]?.failure === null, "A recovered draft still reports the previous provider failure");
	const activatedAgain = await activateZenodoPublication(
		database,
		"ZENACTAA",
		config,
		"mint-zenodo",
	);
	assert(
		activatedAgain.job?.id === fileless.job.id,
		"Activation after draft creation duplicated the job",
	);
	const draftBytes = new TextEncoder().encode("Approved archive file");
	await client.query(
		`UPDATE "item" SET "abstractNote" = 'Ready for archive', "revision" = 2 WHERE "key" = 'ZENACTAA'`,
	);
	await seedPublishedFile(client, "ZENACTAA", "ZENFILAA", draftBytes);
	await activateZenodoPublication(
		database,
		"ZENACTAA",
		config,
		"mint-zenodo",
	);
	let savedDraftTime = new Date();
	const interruptedDraft = await runZenodoPublicationJobsOnce(
		database,
		config,
		memoryStorage(new Map([["public/ZENFILAA.pdf", draftBytes]])),
		{
			now: () => savedDraftTime,
			provider: {
				...emptyProvider,
				prepareCreateRecord: async (request) => {
					assert(
						request.draftDepositionId === "90001",
						"Upload lost the saved draft",
					);
					await request.onPreparedDraft?.({
						depositionId: "90001",
						draftRecordId: "90001",
					});
					throw new Error("Simulated interrupted upload");
				},
			},
		},
	);
	assert(
		interruptedDraft[0]?.status === "retrying",
		"Upload failure was not retriable",
	);
	const retainedDraft = await client.query<{ draft: string; status: string }>(
		`SELECT s."unpublishedDraftDepositionId" AS draft, j.status FROM "publicationSyncState" s JOIN "zenodoPublishJournal" j ON j."itemKey" = s."itemKey" WHERE s."itemKey" = 'ZENACTAA'`,
	);
	assert(
		retainedDraft.rows[0]?.draft === "90001" &&
			retainedDraft.rows[0]?.status === "preparing",
		"Upload failure lost the draft reference or journal",
	);
	savedDraftTime = new Date(savedDraftTime.getTime() + 61_000);
	let continuedDraft: string | undefined;
	const completed = await runZenodoPublicationJobsOnce(
		database,
		config,
		memoryStorage(new Map([["public/ZENFILAA.pdf", draftBytes]])),
		{
			now: () => savedDraftTime,
			provider: {
				...emptyProvider,
				prepareEmptyDraft: async () => {
					throw new Error("Retry must not create another draft");
				},
				discardPreparedDraft: async () => {
					throw new Error("Retry must preserve the saved draft");
				},
				prepareCreateRecord: async (request) => {
					continuedDraft = request.draftDepositionId;
					assert(
						continuedDraft === "90001",
						"The saved draft was not passed to publication",
					);
					const draft = {
						depositionId: continuedDraft,
						draftRecordId: continuedDraft,
					};
					await request.onPreparedDraft?.(draft);
					return draft;
				},
			},
		},
	);
	assert(
		completed[0]?.status === "succeeded" && continuedDraft === "90001",
		"Approved files did not complete the saved draft",
	);
	const completedState = await client.query<{
		draft: string | null;
		record: string;
	}>(
		`SELECT "unpublishedDraftDepositionId" AS draft, "zenodoRecordId" AS record FROM "publicationSyncState" WHERE "itemKey" = 'ZENACTAA'`,
	);
	assert(
		completedState.rows[0]?.draft === null &&
			completedState.rows[0]?.record === "90001",
		"Published draft reference was not transferred to the record",
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
			crossrefWaiting.job !== null,
		"Reserved Crossref DOI did not wait locally",
	);
	await client.query(
		`UPDATE "publicationIdentifier" SET "lifecycle" = 'verified', "verifiedAt" = now() WHERE "itemKey" = 'ZENACTAB' AND "registrar" = 'crossref'`,
	);
	const ready = await activateZenodoPublication(database, "ZENACTAB", config);
	assert(
		ready.state === "queued" && ready.job !== null,
		"Ready target was not queued",
	);
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
	const revisedJobs = await client.query<{
		active: string;
		superseded: string;
	}>(
		`SELECT
			count(*) FILTER (WHERE "processedAt" IS NULL AND "deadLetteredAt" IS NULL AND "supersededAt" IS NULL)::text AS active,
			count(*) FILTER (WHERE "supersededAt" IS NOT NULL)::text AS superseded
		 FROM "publicationSyncJob" WHERE "itemKey" = 'ZENACTAC'`,
	);
	assert(
		revisedJobs.rows[0]?.active === "1" &&
			revisedJobs.rows[0]?.superseded === "1",
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
		changedPolicy.state === "waiting_for_crossref" &&
			changedPolicy.job !== null &&
			changedPolicy.job.id !== oldPolicy.job?.id,
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
		afterUnpublish.state === "waiting_for_file" &&
			afterUnpublish.job !== null &&
			afterUnpublish.job.id !== beforeUnpublish.job?.id,
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
	const filelessRetry = await retryZenodoPublication(
		database,
		"ZENACTAH",
		config,
	);
	assert(
		filelessRetry.job !== null &&
			filelessRetry.state === "waiting_for_file",
		"Failed draft creation could not be retried without a file",
	);

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
			await activateZenodoPublication(
				database,
				"ZENACTAD",
				config,
				policy,
			);
			throw new Error(`External DOI allowed ${policy}`);
		} catch (error) {
			if (!(error instanceof ZenodoActivationValidationError))
				throw error;
		}
	}
	const externalTarget = await client.query(
		`SELECT 1 FROM "publicationTarget" WHERE "itemKey" = 'ZENACTAD'`,
	);
	assert(
		externalTarget.rowCount === 0,
		"Rejected external DOI saved a target",
	);

	const externalBytes = new TextEncoder().encode("outside DOI PDF bytes");
	await seedParent(client, { key: "ZENACTAJ", doi: "10.9999/external-ok" });
	await seedPublishedFile(client, "ZENACTAJ", "ZENFILAJ", externalBytes);
	const checkedDoiUrls: string[] = [];
	const externalActivation = await activateZenodoPublication(
		database,
		"ZENACTAJ",
		config,
		"reuse-external",
		"zenodo-activation-test",
		{
			resolveDoi: async (url) => {
				checkedDoiUrls.push(url);
				return { ok: true, status: 302 };
			},
		},
	);
	assert(
		externalActivation.state === "queued",
		"The outside DOI did not queue",
	);
	const lockedExternalTarget = await client.query<{
		lockedExternalDoi: string | null;
	}>(
		`SELECT "lockedExternalDoi" FROM "publicationTarget" WHERE "itemKey" = 'ZENACTAJ'`,
	);
	assert(
		checkedDoiUrls.join(",") === "https://doi.org/10.9999%2Fexternal-ok" &&
			lockedExternalTarget.rows[0]?.lockedExternalDoi ===
				"10.9999/external-ok",
		"Activation did not check and lock the outside DOI",
	);
	await client.query(
		`UPDATE "item" SET "DOI" = '10.9999/changed-after-activation' WHERE "key" = 'ZENACTAJ'`,
	);
	await client.query(
		`UPDATE "publicationSyncJob"
		 SET "nextAttemptAt" = '2099-01-01T00:00:00Z'
		 WHERE "id" <> $1 AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL AND "supersededAt" IS NULL AND "leaseOwner" IS NULL`,
		[externalActivation.job?.id],
	);
	const changedExternalOutcome = await runZenodoPublicationJobsOnce(
		database,
		config,
		memoryStorage(new Map([["public/ZENFILAJ.pdf", externalBytes]])),
		{
			provider: successfulZenodoProvider(),
			workerId: "changed-external-doi-worker",
			now: () => new Date("2030-08-13T11:00:00.000Z"),
		},
	);
	assert(
		changedExternalOutcome.some(
			(outcome) =>
				outcome.jobId === externalActivation.job?.id &&
				outcome.status === "failed",
		),
		"A changed outside DOI was retried instead of failing permanently",
	);
	const changedExternalFailure = await client.query<{
		deadLetteredAt: Date | null;
		failureClass: string | null;
	}>(
		`SELECT psj."deadLetteredAt", pss."lastFailureClass" AS "failureClass"
		 FROM "publicationSyncJob" psj
		 JOIN "publicationSyncState" pss ON pss."itemKey" = psj."itemKey" AND pss."provider" = psj."provider"
		 WHERE psj."id" = $1`,
		[externalActivation.job?.id],
	);
	assert(
		changedExternalFailure.rows[0]?.deadLetteredAt != null &&
			changedExternalFailure.rows[0]?.failureClass ===
				"ZENODO_EXTERNAL_DOI_CHANGED",
		"The changed outside DOI did not leave a permanent failure record",
	);

	await seedParent(client, { key: "ZENACTAK", doi: "10.5555/library.2" });
	await seedPublishedFile(client, "ZENACTAK", "ZENFILAK");
	try {
		await activateZenodoPublication(
			database,
			"ZENACTAK",
			config,
			"reuse-external",
			"zenodo-activation-test",
			{ resolveDoi: async () => ({ ok: true, status: 302 }) },
		);
		throw new Error("A DOI owned by another local record was reused");
	} catch (error) {
		if (!(error instanceof ZenodoActivationValidationError)) throw error;
	}
	const collisionTarget = await client.query(
		`SELECT 1 FROM "publicationTarget" WHERE "itemKey" = 'ZENACTAK'`,
	);
	assert(
		collisionTarget.rowCount === 0,
		"A DOI collision saved a Zenodo target",
	);

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
	await client.query(
		`UPDATE "item" SET "DOI" = '10.5555/library.3' WHERE "key" = 'ZENACTAC'`,
	);
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
	const publishedBytes = new TextEncoder().encode(
		"verified Zenodo PDF bytes",
	);
	await seedParent(client, { key: "ZENWRKAA" });
	await seedPublishedFile(client, "ZENWRKAA", "ZENPDFWA", publishedBytes);
	await seedCrossref(client, {
		itemKey: "ZENWRKAA",
		doi: "10.5555/library.10",
		lifecycle: "verified",
	});
	await client.query(
		`UPDATE "item" SET "DOI" = '10.5555/library.10' WHERE "key" = 'ZENWRKAA'`,
	);
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
	const relationJob = await client.query<{ idempotencyKey: string }>(
		`SELECT "idempotencyKey" FROM "publicationSyncJob"
		 WHERE "itemKey" = 'ZENWRKAA' AND "provider" = 'crossref'
			AND "processedAt" IS NULL AND "supersededAt" IS NULL`,
	);
	assert(
		relationJob.rows.length === 1 &&
			relationJob.rows[0]?.idempotencyKey.includes(
				`zenodo-version:${publishedState.rows[0]?.versionDoi}`,
			),
		"A new Zenodo version DOI did not queue its Crossref relation update",
	);
	const relationPlan = await buildCrossrefPlan(database, "ZENWRKAA", config);
	const crossrefSnapshot =
		relationPlan.plan.status === "write_required"
			? relationPlan.plan.snapshots.crossrefPayload
			: null;
	assert(
		crossrefSnapshot &&
			typeof crossrefSnapshot === "object" &&
			!Array.isArray(crossrefSnapshot) &&
			(crossrefSnapshot as Record<string, unknown>).relation &&
			JSON.stringify(
				(crossrefSnapshot as Record<string, unknown>).relation,
			).includes(publishedState.rows[0]?.versionDoi ?? "missing"),
		"The Crossref plan omitted the current Zenodo version relation",
	);
	await client.query(
		`UPDATE "publicationSyncJob" SET "supersededAt" = '2030-08-13T10:15:00Z'
		 WHERE "itemKey" = 'ZENWRKAA' AND "provider" = 'crossref'
			AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL`,
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
	const auditBaseline = await client.query<{
		fileManifestHash: string;
		payloadHash: string;
		payloadSnapshot: Record<string, unknown>;
	}>(
		`SELECT
			"lastPayloadHash" AS "payloadHash",
			"lastPayloadSnapshot" AS "payloadSnapshot",
			"lastFileManifestHash" AS "fileManifestHash"
		 FROM "publicationSyncState"
		 WHERE "itemKey" = 'ZENWRKAA' AND "provider" = 'zenodo'`,
	);
	const baseline = auditBaseline.rows[0];
	assert(
		baseline?.payloadHash &&
			baseline.payloadSnapshot &&
			baseline.fileManifestHash,
		"The Zenodo audit fixture has no saved provider state",
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
			"itemKey", "provider", "environment", "canonicalRevision", "fileRevision",
			"reason", "idempotencyKey", "nextAttemptAt"
		) VALUES (
			'ZENWRKAA', 'zenodo', 'sandbox', 2, 1,
			'provider_audit', 'publication:zenodo:sandbox:ZENWRKAA:mint-zenodo:2:1:audit:matched',
			'2030-08-13T10:45:00Z'
		) RETURNING "id"`,
	);
	const matchedAuditResult = await runZenodoPublicationJobsOnce(
		database,
		auditConfig,
		memoryStorage(new Map([["public/ZENPDFWA.pdf", publishedBytes]])),
		{
			provider: successfulZenodoProvider(),
			workerId: "zenodo-audit-worker",
			now: () => new Date("2030-08-13T10:45:00Z"),
		},
	);
	const matchedAuditJob = await client.query<{ lastError: string | null }>(
		`SELECT "lastError" FROM "publicationSyncJob" WHERE "id" = $1`,
		[matchedAudit.rows[0]?.id],
	);
	assert(
		matchedAuditResult.some(
			(outcome) =>
				outcome.jobId === Number(matchedAudit.rows[0]?.id) &&
				outcome.status === "audited",
		),
		`A matching Zenodo audit did not finish with a real receipt: ${JSON.stringify(matchedAuditResult)} ${matchedAuditJob.rows[0]?.lastError ?? ""}`,
	);
	const failedAudit = await client.query<{ id: number }>(
		`INSERT INTO "publicationSyncJob" (
			"itemKey", "provider", "environment", "canonicalRevision", "fileRevision",
			"reason", "idempotencyKey", "nextAttemptAt"
		) VALUES (
			'ZENWRKAA', 'zenodo', 'sandbox', 2, 1,
			'provider_audit', 'publication:zenodo:sandbox:ZENWRKAA:mint-zenodo:2:1:audit:failed',
			'2030-08-13T10:45:30Z'
		) RETURNING "id"`,
	);
	const failedAuditResult = await runZenodoPublicationJobsOnce(
		database,
		auditConfig,
		memoryStorage(new Map([["public/ZENPDFWA.pdf", publishedBytes]])),
		{
			provider: {
				...successfulZenodoProvider(),
				verifyPublishedState: async () => {
					throw new Error("Zenodo audit service unavailable");
				},
			},
			workerId: "zenodo-failed-audit-worker",
			now: () => new Date("2030-08-13T10:45:30Z"),
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
				"Zenodo audit service unavailable",
			),
		"A temporary Zenodo audit failure was not kept for retry",
	);
	await client.query(
		`UPDATE "publicationSyncJob" SET "supersededAt" = '2030-08-13T10:45:31Z'
		 WHERE "id" = $1`,
		[failedAudit.rows[0]?.id],
	);

	const driftAudit = await client.query<{ id: number }>(
		`INSERT INTO "publicationSyncJob" (
			"itemKey", "provider", "environment", "canonicalRevision", "fileRevision",
			"reason", "idempotencyKey", "nextAttemptAt"
		) VALUES (
			'ZENWRKAA', 'zenodo', 'sandbox', 2, 1,
			'provider_audit', 'publication:zenodo:sandbox:ZENWRKAA:mint-zenodo:2:1:audit:drift',
			'2030-08-13T10:46:00Z'
		) RETURNING "id"`,
	);
	const driftAuditResult = await runZenodoPublicationJobsOnce(
		database,
		auditConfig,
		memoryStorage(new Map([["public/ZENPDFWA.pdf", publishedBytes]])),
		{
			provider: {
				...successfulZenodoProvider(),
				verifyPublishedState: async () => ({
					status: "drifted",
					metadataReasons: ["metadata.title"],
					fileReasons: [],
				}),
			},
			workerId: "zenodo-drift-audit-worker",
			now: () => new Date("2030-08-13T10:46:00Z"),
		},
	);
	assert(
		driftAuditResult.some(
			(outcome) =>
				outcome.jobId === Number(driftAudit.rows[0]?.id) &&
				outcome.status === "drifted",
		),
		"Zenodo metadata drift was not detected",
	);
	const driftSettlement = await client.query<{
		fileManifestHash: string | null;
		payloadHash: string | null;
		repairKey: string | null;
	}>(
		`SELECT
			pss."lastPayloadHash" AS "payloadHash",
			pss."lastFileManifestHash" AS "fileManifestHash",
			(
				SELECT psj."idempotencyKey" FROM "publicationSyncJob" psj
				WHERE psj."itemKey" = pss."itemKey"
					AND psj."reason" = 'nightly_reconciliation'
					AND psj."supersededAt" IS NULL
				ORDER BY psj."id" DESC LIMIT 1
			) AS "repairKey"
		 FROM "publicationSyncState" pss
		 WHERE pss."itemKey" = 'ZENWRKAA' AND pss."provider" = 'zenodo'`,
	);
	assert(
		driftSettlement.rows[0]?.payloadHash === null &&
			driftSettlement.rows[0]?.fileManifestHash ===
				baseline.fileManifestHash &&
			driftSettlement.rows[0]?.repairKey?.endsWith(
				`audit:${driftAudit.rows[0]?.id}`,
			),
		`Zenodo metadata drift did not clear only metadata state and queue one repair: ${JSON.stringify(driftSettlement.rows[0])}`,
	);
	await client.query(
		`UPDATE "publicationSyncState"
		 SET "lastPayloadHash" = $1, "lastPayloadSnapshot" = $2::jsonb
		 WHERE "itemKey" = 'ZENWRKAA' AND "provider" = 'zenodo'`,
		[baseline.payloadHash, JSON.stringify(baseline.payloadSnapshot)],
	);
	await client.query(
		`UPDATE "publicationSyncJob" SET "supersededAt" = '2030-08-13T10:47:00Z'
		 WHERE "itemKey" = 'ZENWRKAA' AND "reason" = 'nightly_reconciliation'
			AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL`,
	);
	const fileDriftAudit = await client.query<{ id: number }>(
		`INSERT INTO "publicationSyncJob" (
			"itemKey", "provider", "environment", "canonicalRevision", "fileRevision",
			"reason", "idempotencyKey", "nextAttemptAt"
		) VALUES (
			'ZENWRKAA', 'zenodo', 'sandbox', 2, 1,
			'provider_audit', 'publication:zenodo:sandbox:ZENWRKAA:mint-zenodo:2:1:audit:file-drift',
			'2030-08-13T10:48:00Z'
		) RETURNING "id"`,
	);
	const fileDriftResult = await runZenodoPublicationJobsOnce(
		database,
		auditConfig,
		memoryStorage(new Map([["public/ZENPDFWA.pdf", publishedBytes]])),
		{
			provider: {
				...successfulZenodoProvider(),
				verifyPublishedState: async () => ({
					status: "drifted",
					metadataReasons: [],
					fileReasons: ["files.ZENPDFWA.pdf.md5"],
				}),
			},
			workerId: "zenodo-file-audit-worker",
			now: () => new Date("2030-08-13T10:48:00Z"),
		},
	);
	assert(
		fileDriftResult.some(
			(outcome) =>
				outcome.jobId === Number(fileDriftAudit.rows[0]?.id) &&
				outcome.status === "drifted",
		),
		"Zenodo file drift was not detected",
	);
	const fileDriftState = await client.query<{
		fileManifestHash: string | null;
		payloadHash: string | null;
	}>(
		`SELECT
			"lastPayloadHash" AS "payloadHash",
			"lastFileManifestHash" AS "fileManifestHash"
		 FROM "publicationSyncState"
		 WHERE "itemKey" = 'ZENWRKAA' AND "provider" = 'zenodo'`,
	);
	assert(
		fileDriftState.rows[0]?.payloadHash === baseline.payloadHash &&
			fileDriftState.rows[0]?.fileManifestHash === null,
		"Zenodo file drift did not preserve the settled metadata bundle",
	);
	await client.query(
		`UPDATE "publicationSyncState"
		 SET "lastFileManifestHash" = $1,
			"lastFileManifestSnapshot" = $2::jsonb
		 WHERE "itemKey" = 'ZENWRKAA' AND "provider" = 'zenodo'`,
		[
			baseline.fileManifestHash,
			JSON.stringify(preservedFileState.rows[0]?.fileManifestSnapshot),
		],
	);
	await client.query(
		`UPDATE "publicationSyncJob" SET "supersededAt" = '2030-08-13T10:49:00Z'
		 WHERE "itemKey" = 'ZENWRKAA' AND "reason" = 'nightly_reconciliation'
			AND "processedAt" IS NULL AND "deadLetteredAt" IS NULL`,
	);
	const staleAudit = await client.query<{ id: number }>(
		`INSERT INTO "publicationSyncJob" (
			"itemKey", "provider", "environment", "canonicalRevision", "fileRevision",
			"reason", "idempotencyKey", "nextAttemptAt"
		) VALUES (
			'ZENWRKAA', 'zenodo', 'sandbox', 2, 1,
			'provider_audit', 'publication:zenodo:sandbox:ZENWRKAA:mint-zenodo:2:1:audit:stale',
			'2030-08-13T10:50:00Z'
		) RETURNING "id"`,
	);
	const changedHash = "c".repeat(64);
	await runZenodoPublicationJobsOnce(
		database,
		auditConfig,
		memoryStorage(new Map([["public/ZENPDFWA.pdf", publishedBytes]])),
		{
			provider: {
				...successfulZenodoProvider(),
				verifyPublishedState: async () => {
					await client.query(
						`UPDATE "publicationSyncState" SET "lastPayloadHash" = $1
						 WHERE "itemKey" = 'ZENWRKAA' AND "provider" = 'zenodo'`,
						[changedHash],
					);
					return {
						status: "drifted",
						metadataReasons: ["metadata.title"],
						fileReasons: [],
					};
				},
			},
			workerId: "zenodo-stale-audit-worker",
			now: () => new Date("2030-08-13T10:50:00Z"),
		},
	);
	const staleAuditState = await client.query<{
		auditStatus: string;
		payloadHash: string | null;
		repairCount: number;
	}>(
		`SELECT
			pss."lastPayloadHash" AS "payloadHash",
			psj."resultReceipt"->'audit'->>'status' AS "auditStatus",
			(
				SELECT count(*)::int FROM "publicationSyncJob" repair
				WHERE repair."idempotencyKey" LIKE $2
			) AS "repairCount"
		 FROM "publicationSyncState" pss
		 JOIN "publicationSyncJob" psj ON psj."id" = $1
		 WHERE pss."itemKey" = 'ZENWRKAA' AND pss."provider" = 'zenodo'`,
		[staleAudit.rows[0]?.id, `%audit:${staleAudit.rows[0]?.id}`],
	);
	assert(
		staleAuditState.rows[0]?.payloadHash === changedHash &&
			staleAuditState.rows[0]?.auditStatus === "skipped" &&
			Number(staleAuditState.rows[0]?.repairCount) === 0,
		"A stale Zenodo audit overwrote newer local publication state",
	);
	await client.query(
		`UPDATE "publicationSyncState"
		 SET "lastPayloadHash" = $1, "lastPayloadSnapshot" = $2::jsonb
		 WHERE "itemKey" = 'ZENWRKAA' AND "provider" = 'zenodo'`,
		[baseline.payloadHash, JSON.stringify(baseline.payloadSnapshot)],
	);

	const recoveryBytes = new TextEncoder().encode(
		"recoverable Zenodo PDF bytes",
	);
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
	await client.query(
		`UPDATE "item" SET "deleted" = 1 WHERE "key" = 'ZENWRKAD'`,
	);
	const preplanConfig = {
		...recoveryConfig,
		services: {
			...recoveryConfig.services,
			publication: {
				...recoveryConfig.services.publication,
				worker: {
					...recoveryConfig.services.publication.worker,
					retryLimit: 1,
				},
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
	assert(
		existingVersionDoi,
		"The collision fixture has no existing Zenodo DOI",
	);
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
	await client.query(
		`UPDATE "publicationSyncJob"
		 SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "supersededAt" = $1
		 WHERE "id" = ANY($2::bigint[])`,
		[claimTime, [firstClaim.id, secondClaim.id]],
	);

	const leaseBytes = new TextEncoder().encode("serialized Zenodo lease");
	await seedParent(client, { key: "ZENWRKAH" });
	await seedPublishedFile(client, "ZENWRKAH", "ZENPDFWH", leaseBytes);
	const leaseActivation = await activateZenodoPublication(
		database,
		"ZENWRKAH",
		config,
		"mint-zenodo",
	);
	const leaseStart = new Date("2030-08-13T13:00:00Z");
	const leasedJob = await claimNextPublicationJob(database, {
		provider: "zenodo",
		environment: "sandbox",
		workerId: "lease-owner",
		leaseSeconds: 60,
		claimedAt: leaseStart,
	});
	assert(
		leasedJob && leasedJob.id === leaseActivation.job?.id,
		"The lease test did not claim its first job",
	);
	await client.query(
		`INSERT INTO "publicationSyncJob" (
			"itemKey", "provider", "environment", "canonicalRevision", "fileRevision",
			"reason", "idempotencyKey", "nextAttemptAt"
		) VALUES (
			'ZENWRKAH', 'zenodo', 'sandbox', 2, 1,
			'record_changed', 'publication:zenodo:sandbox:ZENWRKAH:mint-zenodo:2:1', $1
		)`,
		[leaseStart],
	);
	const blockedSibling = await claimNextPublicationJob(database, {
		provider: "zenodo",
		environment: "sandbox",
		workerId: "blocked-sibling-worker",
		leaseSeconds: 60,
		claimedAt: new Date(leaseStart.getTime() + 1_000),
	});
	assert(
		blockedSibling === null,
		"A newer Zenodo job ran beside an older leased job for the same record",
	);
	let expiredLeaseRejected = false;
	try {
		await finishPublicationJob(database, {
			jobId: leasedJob.id,
			workerId: "lease-owner",
			finishedAt: new Date(leaseStart.getTime() + 61_000),
			receipt: { provider: "zenodo" },
		});
	} catch (error) {
		expiredLeaseRejected = error instanceof PublicationJobLeaseLostError;
	}
	assert(
		expiredLeaseRejected,
		"A worker settled a Zenodo job after its lease expired",
	);
	let expiredDeferRejected = false;
	try {
		await deferPublicationJob(database, {
			jobId: leasedJob.id,
			workerId: "lease-owner",
			deferredAt: new Date(leaseStart.getTime() + 61_000),
			delayMs: 60_000,
			error: "simulated retry",
			deadLetter: false,
		});
	} catch (error) {
		expiredDeferRejected = error instanceof PublicationJobLeaseLostError;
	}
	assert(
		expiredDeferRejected,
		"A worker deferred a Zenodo job after its lease expired",
	);
}

async function verifyIsolatedDatabase() {
	await withIsolatedPublicationDatabase(async (database, client) => {
		await verify(database, client);
	});
}

describe("Zenodo activation against an isolated database", () => {
	it("keeps policy, dependencies, and jobs durable", async () => {
		await verifyIsolatedDatabase();
	}, 120_000);
});

it("resumes production archive drafts without consuming Sandbox work", async () => {
	await withIsolatedPublicationDatabase(async (database, client) => {
		const production = structuredClone(config);
		production.services.publication.crossref.environment = "production";
		production.services.publication.zenodo.environment = "production";
		await seedParent(client, { key: "ZENPRDAA" });
		await activateZenodoPublication(
			database,
			"ZENPRDAA",
			config,
			"mint-zenodo",
		);
		const activated = await activateZenodoPublication(
			database,
			"ZENPRDAA",
			production,
			"mint-zenodo",
		);
		assert(
			activated.environment === "production",
			"Activation returned the wrong environment",
		);
		const requests: string[] = [];
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (url, init) => {
				requests.push(String(url));
				assert(
					String(url) ===
						"https://zenodo.org/api/deposit/depositions",
					"Production used a different endpoint",
				);
				assert.deepEqual(
					{ method: init?.method, body: init?.body },
					{ method: "POST", body: "{}" },
					"Fileless activation sent publication metadata",
				);
				return Response.json({
					id: "990001",
					record_id: "990001",
					conceptrecid: "990000",
					submitted: false,
					state: "unsubmitted",
					metadata: {},
					files: [],
					links: {
						self: "https://zenodo.org/api/deposit/depositions/990001",
						html: "https://zenodo.org/deposit/990001",
					},
				});
			});
		try {
			const result = await runZenodoPublicationJobsOnce(
				database,
				production,
				memoryStorage(new Map()),
			);
			assert.deepEqual(
				result.map((outcome) => outcome.status),
				["waiting"],
				"Production did not prepare its fileless draft",
			);
		} finally {
			fetchSpy.mockRestore();
		}
		assert(requests.length === 1, "Production created duplicate drafts");
		const states = await client.query(
			`SELECT "environment", "unpublishedDraftDepositionId" FROM "publicationSyncState" WHERE "itemKey" = 'ZENPRDAA'`,
		);
		assert.deepEqual(
			states.rows,
			[
				{
					environment: "production",
					unpublishedDraftDepositionId: "990001",
				},
			],
			"Production draft state crossed environments",
		);
		const sandboxJob = await client.query(
			`SELECT "attempts", "processedAt" FROM "publicationSyncJob" WHERE "itemKey" = 'ZENPRDAA' AND "environment" = 'sandbox'`,
		);
		assert.deepEqual(
			sandboxJob.rows,
			[{ attempts: 0, processedAt: null }],
			"Production consumed the sandbox job",
		);
		const bytes = new TextEncoder().encode("Production archive file");
		await seedPublishedFile(client, "ZENPRDAA", "ZENPRDFA", bytes);
		await client.query(
			`UPDATE "item" SET "revision" = 2 WHERE "key" = 'ZENPRDAA'`,
		);
		await activateZenodoPublication(
			database,
			"ZENPRDAA",
			production,
			"mint-zenodo",
		);
		const provider = successfulZenodoProvider();
		const uploaded = await runZenodoPublicationJobsOnce(
			database,
			production,
			memoryStorage(new Map([["public/ZENPRDFA.pdf", bytes]])),
			{
				provider: {
					...provider,
					prepareCreateRecord: async (request) => {
						assert(
							request.draftDepositionId === "990001",
							"Production lost its saved draft",
						);
						return provider.prepareCreateRecord({
							...request,
							onPreparedDraft: async (draft) => {
								await client.query(
									`INSERT INTO "zenodoPublishJournal" ("itemKey", "environment", "operationType", "payloadHash", "payloadSnapshot", "depositionId", "draftRecordId", "status") VALUES ('ZENPRDAA', 'sandbox', 'zenodo_create', repeat('b',64), '{}'::jsonb, $1, $1, 'preparing')`,
									[draft.depositionId],
								);
								await request.onPreparedDraft?.(draft);
							},
						});
					},
				},
			},
		);
		assert(
			uploaded[0]?.status === "succeeded",
			"Production file upload did not settle",
		);
		const identifiers = await client.query(
			`SELECT "environment" FROM "publicationIdentifier" WHERE "itemKey" = 'ZENPRDAA'`,
		);
		assert.deepEqual(
			identifiers.rows,
			[{ environment: "production" }, { environment: "production" }],
			"Production identifiers were saved under Sandbox",
		);
		const sandboxJournal = await client.query(
			`SELECT "status", "payloadHash" FROM "zenodoPublishJournal" WHERE "itemKey" = 'ZENPRDAA' AND "environment" = 'sandbox'`,
		);
		assert.deepEqual(
			sandboxJournal.rows,
			[{ status: "preparing", payloadHash: "b".repeat(64) }],
			"Production settlement changed a colliding sandbox journal",
		);
		const overview = await getAdminPublicationWorkerOverview(
			database,
			production,
		);
		assert.deepEqual(
			{
				hasPending: overview.queue.hasPending,
				hasFailed: overview.queue.hasFailed,
			},
			{ hasPending: false, hasFailed: false },
			"Production worker status included sandbox work",
		);
		const beforeAudit = await client.query(
			`SELECT count(*)::int AS count FROM "publicationSyncJob" WHERE "environment" = 'sandbox'`,
		);
		await runNightlyPublicationReconciliation(database, production, {
			workerId: "production-reconciliation",
		});
		const afterAudit = await client.query(
			`SELECT count(*)::int AS count FROM "publicationSyncJob" WHERE "environment" = 'sandbox'`,
		);
		assert(
			afterAudit.rows[0].count === beforeAudit.rows[0].count,
			"Production reconciliation queued sandbox work",
		);
	});
}, 120_000);
