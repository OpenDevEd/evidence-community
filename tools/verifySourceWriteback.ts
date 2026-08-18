import { setTimeout as delay } from "node:timers/promises";

import {
	itemDraft,
	itemIdentity,
	itemSourceLink,
	outbox,
	sourceConnection,
	sourceWritebackJob,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { sourceSnapshot } from "../src/db/schema/source";
import { item } from "../src/db/schema/tables/item";
import { itemToCollection } from "../src/db/schema/tables/itemToCollection";
import { itemToTag } from "../src/db/schema/tables/itemToTag";
import {
	createNativeItemDraft,
	type ItemPublishOptions,
	openItemDraft,
	publishItemDraft,
	publishItemDraftWithContext,
	saveItemDraft,
	type ItemWritebackPolicyOptions,
	unpublishNativeItem,
} from "../src/lib/admin/native-item-service";
import {
	getAdminSourceWritebackStatus,
	resolveAdminSourceWritebackConflict,
	retryAdminSourceWriteback,
	setAdminItemWritebackSources,
} from "../src/lib/admin/source-writeback-service";
import type { JsonValue } from "../src/lib/source-ingestion/batch-schema";
import { sourcePayloadHash } from "../src/lib/source-ingestion/fingerprint";
import { writeSourceIngestionBatch } from "../src/lib/source-ingestion/transactional-writer";
import {
	SourceWritebackAdapterRegistry,
	type SourceWritebackRemoteRecord,
	type SourceWritebackRequest,
} from "../src/lib/source-writeback/adapter";
import {
	processNextSourceWritebackJob,
	type SourceWritebackConsumerOptions,
} from "../src/lib/source-writeback/consumer";
import {
	enqueueSourceWritebackJob,
	SourceWritebackTargetKeyCollisionError,
} from "../src/lib/source-writeback/queue";
import { runSourceWritebackWorker } from "../src/lib/source-writeback/worker";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function verify() {
	const resource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const db = resource.database;
	const marker = `${process.pid}-${Date.now()}`;
	const connectionKey = `zotero-writeback-${marker}`.slice(0, 64);
	const createdItemKeys: string[] = [];
	let behavior: "block" | "fail" | "success" = "success";
	let releaseBlocked = () => {};
	let markBlocked = () => {};
	let blocked = Promise.resolve();
	let sourceGateEnabled = true;
	let version = 0;
	const calls: SourceWritebackRequest[] = [];
	const writebackPolicyOptions = {
		writebackConfig: {
			sources: [{ key: connectionKey, writebackEnabled: true }],
		},
	} satisfies ItemWritebackPolicyOptions;
	// Native records choose their writeback sources when they publish.
	const publishToSource = {
		...writebackPolicyOptions,
		sourceKeys: [connectionKey],
	} satisfies ItemPublishOptions;

	// The fake source reports one shared version counter; a test can override
	// it to simulate a remote edit while a link was paused.
	const fakeRemote: {
		record: SourceWritebackRemoteRecord | null;
		version: (() => string | null) | null;
	} = { record: null, version: null };
	const registry = new SourceWritebackAdapterRegistry([
		{
			provider: "zotero",
			readRecord: async () => fakeRemote.record,
			readVersion: async () =>
				fakeRemote.version ? fakeRemote.version() : String(version),
			write: async (request, { signal }) => {
				calls.push(structuredClone(request));
				if (behavior === "fail")
					throw new Error("deliberate remote failure");
				if (behavior === "block") {
					markBlocked();
					await Promise.race([
						blocked,
						new Promise<never>((_, reject) =>
							signal.addEventListener(
								"abort",
								() => reject(signal.reason),
								{ once: true },
							),
						),
					]);
				}
				version += 1;
				const payload = structuredClone(request.payload) as Record<
					string,
					unknown
				>;
				return {
					remoteVersion: String(version),
					snapshot: {
						fingerprint: sourcePayloadHash(payload as JsonValue),
						mappingProfileVersion: "fake-writeback-v1",
						payload,
					},
					sourceRecordKey: request.sourceRecordKey,
				};
			},
		},
	]);
	const consumerOptions: SourceWritebackConsumerOptions = {
		database: db,
		heartbeatIntervalMs: 100,
		leaseDurationMs: 1_000,
		maxAttempts: 2,
		registry,
		retryBaseMs: 100,
		retryMaxMs: 100,
		sourceWritebackEnabled: () => sourceGateEnabled,
		workerId: `writeback-verifier-${marker}`,
	};

	try {
		await db.insert(sourceConnection).values({
			externalScopeKey: `writeback-${marker}`,
			key: connectionKey,
			provider: "zotero",
			scopeKind: "group",
		});

		const disabledLinkDraft = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Explicitly local item",
		});
		createdItemKeys.push(disabledLinkDraft.itemKey);
		await db.insert(itemSourceLink).values({
			itemKey: disabledLinkDraft.itemKey,
			sourceConnectionKey: connectionKey,
			sourceRecordKey: disabledLinkDraft.itemKey,
			writebackEnabled: false,
		});
		await publishItemDraft(db, disabledLinkDraft.itemKey);
		const [[preservedDisabledLink], disabledJobs] = await Promise.all([
			db
				.select({ writebackEnabled: itemSourceLink.writebackEnabled })
				.from(itemSourceLink)
				.where(eq(itemSourceLink.itemKey, disabledLinkDraft.itemKey)),
			db
				.select({ id: sourceWritebackJob.id })
				.from(sourceWritebackJob)
				.where(
					eq(sourceWritebackJob.itemKey, disabledLinkDraft.itemKey),
				),
		]);
		assert(
			preservedDisabledLink?.writebackEnabled === false &&
				disabledJobs.length === 0,
			"Publishing without choosing sources re-enabled a deliberately disabled source link",
		);

		const collisionOwner = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Remote key owner",
		});
		const collisionDraft = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Remote key collision",
		});
		createdItemKeys.push(collisionOwner.itemKey, collisionDraft.itemKey);
		await db.insert(itemSourceLink).values({
			itemKey: collisionOwner.itemKey,
			sourceConnectionKey: connectionKey,
			sourceRecordKey: collisionDraft.itemKey,
			writebackEnabled: false,
		});
		let collisionRejected = false;
		try {
			await publishItemDraftWithContext(
				db,
				collisionDraft.itemKey,
				publishToSource,
			);
		} catch (error) {
			collisionRejected =
				error instanceof SourceWritebackTargetKeyCollisionError;
		}
		assert(
			collisionRejected,
			"A target-key collision did not produce the explicit writeback error",
		);

		const nativeDraft = await createNativeItemDraft(db, {
			abstractNote: "First abstract",
			itemType: "report",
			tags: ["writeback-test"],
			title: "First title",
		});
		createdItemKeys.push(nativeDraft.itemKey);
		const firstPublished = (
			await publishItemDraftWithContext(
				db,
				nativeDraft.itemKey,
				publishToSource,
			)
		).item;
		const [[firstLink], [firstJob]] = await Promise.all([
			db
				.select()
				.from(itemSourceLink)
				.where(eq(itemSourceLink.itemKey, nativeDraft.itemKey)),
			db
				.select()
				.from(sourceWritebackJob)
				.where(eq(sourceWritebackJob.itemKey, nativeDraft.itemKey)),
		]);
		assert(
			firstPublished.revision === 1 &&
				firstLink?.sourceConnectionKey === connectionKey &&
				firstLink.sourceRecordKey === nativeDraft.itemKey &&
				firstLink.writebackEnabled &&
				firstJob?.operation === "upsert" &&
				firstJob.canonicalRevision === 1,
			"A native first publish did not link the chosen writeback source and queue creation",
		);

		const firstResult =
			await processNextSourceWritebackJob(consumerOptions);
		const [[acknowledgedLink], [snapshot]] = await Promise.all([
			db
				.select()
				.from(itemSourceLink)
				.where(eq(itemSourceLink.itemKey, nativeDraft.itemKey)),
			db
				.select()
				.from(sourceSnapshot)
				.where(eq(sourceSnapshot.itemKey, nativeDraft.itemKey)),
		]);
		assert(
			firstResult.status === "processed" &&
				acknowledgedLink?.remoteVersion === "1" &&
				acknowledgedLink.dirtyFields.length === 0 &&
				snapshot?.remoteVersion === "1",
			"The worker did not acknowledge a successful create and persist its remote baseline",
		);

		const parentDraft = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Writeback parent",
		});
		const childDraft = await createNativeItemDraft(db, {
			itemType: "Note",
			note: "Writeback child",
			parentItem: parentDraft.itemKey,
		});
		createdItemKeys.push(parentDraft.itemKey, childDraft.itemKey);
		await publishItemDraftWithContext(
			db,
			parentDraft.itemKey,
			publishToSource,
		);
		await publishItemDraft(db, childDraft.itemKey);
		const [parentJob] = await db
			.select({ id: sourceWritebackJob.id })
			.from(sourceWritebackJob)
			.where(eq(sourceWritebackJob.itemKey, parentDraft.itemKey))
			.limit(1);
		assert(parentJob, "The parent writeback job was not queued");
		await db
			.update(sourceWritebackJob)
			.set({ nextAttemptAt: new Date(Date.now() + 60_000) })
			.where(eq(sourceWritebackJob.id, parentJob.id));
		const waitingChild =
			await processNextSourceWritebackJob(consumerOptions);
		const [waitingChildJob] = await db
			.select({
				attempts: sourceWritebackJob.attempts,
				lastError: sourceWritebackJob.lastError,
			})
			.from(sourceWritebackJob)
			.where(eq(sourceWritebackJob.id, waitingChild.jobId!));
		assert(
			waitingChild.status === "deferred" &&
				waitingChild.itemKey === childDraft.itemKey &&
				waitingChildJob?.attempts === 0 &&
				waitingChildJob.lastError?.includes("writeback is pending"),
			"A child write consumed an attempt before its parent had a remote identity",
		);
		await db
			.update(sourceWritebackJob)
			.set({ nextAttemptAt: new Date(0) })
			.where(eq(sourceWritebackJob.id, parentJob.id));
		const writtenParent =
			await processNextSourceWritebackJob(consumerOptions);
		assert(
			writtenParent.status === "processed" &&
				writtenParent.itemKey === parentDraft.itemKey,
			"The parent was not written before its deferred child",
		);
		await db
			.update(sourceWritebackJob)
			.set({ nextAttemptAt: new Date(0) })
			.where(eq(sourceWritebackJob.id, waitingChild.jobId!));
		const writtenChild =
			await processNextSourceWritebackJob(consumerOptions);
		assert(
			writtenChild.status === "processed" &&
				calls.at(-1)?.payload.parentItem === parentDraft.itemKey,
			"The child was not written with its acknowledged parent identity",
		);

		const failedParentDraft = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Failed writeback parent",
		});
		const blockedChildDraft = await createNativeItemDraft(db, {
			itemType: "Note",
			note: "Child of failed writeback",
			parentItem: failedParentDraft.itemKey,
		});
		createdItemKeys.push(
			failedParentDraft.itemKey,
			blockedChildDraft.itemKey,
		);
		await publishItemDraftWithContext(
			db,
			failedParentDraft.itemKey,
			publishToSource,
		);
		await publishItemDraft(db, blockedChildDraft.itemKey);
		const [failedParentJob] = await db
			.select({ id: sourceWritebackJob.id })
			.from(sourceWritebackJob)
			.where(eq(sourceWritebackJob.itemKey, failedParentDraft.itemKey))
			.limit(1);
		assert(failedParentJob, "The failed parent job was not queued");
		await db
			.update(sourceWritebackJob)
			.set({
				deadLetteredAt: new Date(),
				lastError: "Deliberate parent failure",
			})
			.where(eq(sourceWritebackJob.id, failedParentJob.id));
		const blockedChild =
			await processNextSourceWritebackJob(consumerOptions);
		const [blockedChildJob] = await db
			.select({
				attempts: sourceWritebackJob.attempts,
				lastError: sourceWritebackJob.lastError,
			})
			.from(sourceWritebackJob)
			.where(eq(sourceWritebackJob.id, blockedChild.jobId!));
		assert(
			blockedChild.status === "retrying" &&
				blockedChild.itemKey === blockedChildDraft.itemKey &&
				blockedChildJob?.attempts === 1 &&
				blockedChildJob.lastError?.includes(
					"no viable writeback queued",
				),
			"A child without a viable parent writeback was deferred forever",
		);
		await db
			.update(sourceWritebackJob)
			.set({ deadLetteredAt: new Date() })
			.where(eq(sourceWritebackJob.id, blockedChild.jobId!));

		const openedSecond = await openItemDraft(db, nativeDraft.itemKey);
		await saveItemDraft(db, {
			expectedDraftRevision: openedSecond.draftRevision,
			expectedPayload: openedSecond.payload,
			itemKey: nativeDraft.itemKey,
			payload: { ...openedSecond.payload, title: "Second title" },
		});
		await publishItemDraft(db, nativeDraft.itemKey);

		behavior = "block";
		blocked = new Promise<void>((resolve) => {
			releaseBlocked = resolve;
		});
		const writeStarted = new Promise<void>((resolve) => {
			markBlocked = resolve;
		});
		const inFlight = processNextSourceWritebackJob(consumerOptions);
		await writeStarted;
		const openedThird = await openItemDraft(db, nativeDraft.itemKey);
		await saveItemDraft(db, {
			expectedDraftRevision: openedThird.draftRevision,
			expectedPayload: openedThird.payload,
			itemKey: nativeDraft.itemKey,
			payload: { ...openedThird.payload, abstractNote: "Third abstract" },
		});
		await publishItemDraft(db, nativeDraft.itemKey);
		await delay(1_100);
		const concurrentClaim = await processNextSourceWritebackJob({
			...consumerOptions,
			workerId: `${consumerOptions.workerId}-concurrent`,
		});
		assert(
			concurrentClaim.status === "idle",
			"A second worker processed a later revision while the same source item was leased",
		);
		releaseBlocked();
		behavior = "success";
		const inFlightResult = await inFlight;
		const [dirtyAfterConcurrentEdit] = await db
			.select({ dirtyFields: itemSourceLink.dirtyFields })
			.from(itemSourceLink)
			.where(eq(itemSourceLink.itemKey, nativeDraft.itemKey));
		assert(
			inFlightResult.status === "processed" &&
				dirtyAfterConcurrentEdit?.dirtyFields.includes("title") &&
				dirtyAfterConcurrentEdit.dirtyFields.includes("abstractNote"),
			"Acknowledging an older remote write erased a newer local edit",
		);
		const newestResult =
			await processNextSourceWritebackJob(consumerOptions);
		const [cleanAfterNewest] = await db
			.select({ dirtyFields: itemSourceLink.dirtyFields })
			.from(itemSourceLink)
			.where(eq(itemSourceLink.itemKey, nativeDraft.itemKey));
		assert(
			newestResult.status === "processed" &&
				cleanAfterNewest?.dirtyFields.length === 0,
			"The newest acknowledged revision did not clear its accumulated dirty fields",
		);

		const openedRetry = await openItemDraft(db, nativeDraft.itemKey);
		await saveItemDraft(db, {
			expectedDraftRevision: openedRetry.draftRevision,
			expectedPayload: openedRetry.payload,
			itemKey: nativeDraft.itemKey,
			payload: { ...openedRetry.payload, title: "Retry title" },
		});
		await publishItemDraft(db, nativeDraft.itemKey);
		behavior = "fail";
		const retryResult =
			await processNextSourceWritebackJob(consumerOptions);
		const retryCall = calls.at(-1)!;
		assert(
			retryResult.status === "retrying",
			"A transient failure was not scheduled for retry",
		);
		await db
			.update(sourceWritebackJob)
			.set({ nextAttemptAt: new Date(0) })
			.where(eq(sourceWritebackJob.id, retryResult.jobId!));
		behavior = "success";
		const recoveredResult =
			await processNextSourceWritebackJob(consumerOptions);
		assert(
			recoveredResult.status === "processed" &&
				calls.at(-1)?.idempotencyKey === retryCall.idempotencyKey,
			"A retried write did not recover with the original idempotency key",
		);

		const openedDeadLetter = await openItemDraft(db, nativeDraft.itemKey);
		await saveItemDraft(db, {
			expectedDraftRevision: openedDeadLetter.draftRevision,
			expectedPayload: openedDeadLetter.payload,
			itemKey: nativeDraft.itemKey,
			payload: {
				...openedDeadLetter.payload,
				title: "Dead-letter title",
			},
		});
		await publishItemDraft(db, nativeDraft.itemKey);
		behavior = "fail";
		const firstFailure =
			await processNextSourceWritebackJob(consumerOptions);
		await db
			.update(sourceWritebackJob)
			.set({ nextAttemptAt: new Date(0) })
			.where(eq(sourceWritebackJob.id, firstFailure.jobId!));
		const finalFailure =
			await processNextSourceWritebackJob(consumerOptions);
		assert(
			firstFailure.status === "retrying" &&
				finalFailure.status === "dead-lettered",
			"Repeated remote failures did not reach the configured dead letter state",
		);
		const failedStatus = await getAdminSourceWritebackStatus(
			db,
			nativeDraft.itemKey,
			connectionKey,
			writebackPolicyOptions.writebackConfig,
		);
		assert(
			failedStatus.state === "failed" &&
				failedStatus.jobId === finalFailure.jobId &&
				failedStatus.error?.includes("deliberate remote failure"),
			"The admin status did not expose the dead-lettered writeback failure",
		);
		const requeuedStatus = await retryAdminSourceWriteback(
			db,
			nativeDraft.itemKey,
			connectionKey,
			writebackPolicyOptions.writebackConfig,
		);
		assert(
			requeuedStatus.state === "queued" && requeuedStatus.attempts === 0,
			"The admin retry did not requeue the failed writeback job",
		);
		behavior = "success";
		const manualRetry =
			await processNextSourceWritebackJob(consumerOptions);
		const syncedStatus = await getAdminSourceWritebackStatus(
			db,
			nativeDraft.itemKey,
			connectionKey,
			writebackPolicyOptions.writebackConfig,
		);
		assert(
			manualRetry.status === "processed" &&
				syncedStatus.state === "synced",
			"The manually retried writeback did not reach the synced state",
		);

		const staleDraft = await createNativeItemDraft(db, {
			itemType: "report",
			title: "Never-created remote item",
		});
		createdItemKeys.push(staleDraft.itemKey);
		await publishItemDraftWithContext(
			db,
			staleDraft.itemKey,
			publishToSource,
		);
		await unpublishNativeItem(db, staleDraft.itemKey);
		const callsBeforeSupersession = calls.length;
		const staleUpsert =
			await processNextSourceWritebackJob(consumerOptions);
		assert(
			staleUpsert.status === "superseded" &&
				calls.length === callsBeforeSupersession,
			"An obsolete create was sent after the item had already been unpublished",
		);
		const deleteResult =
			await processNextSourceWritebackJob(consumerOptions);
		assert(
			deleteResult.status === "processed" &&
				calls.at(-1)?.operation === "delete",
			"The current unpublish state was not written after superseding its stale create",
		);

		const restoreOpened = await openItemDraft(db, staleDraft.itemKey);
		await saveItemDraft(db, {
			expectedDraftRevision: restoreOpened.draftRevision,
			expectedPayload: restoreOpened.payload,
			itemKey: staleDraft.itemKey,
			payload: { ...restoreOpened.payload, title: "Restored item" },
		});
		await publishItemDraft(db, staleDraft.itemKey);
		await unpublishNativeItem(db, staleDraft.itemKey);
		const secondRestoreOpened = await openItemDraft(db, staleDraft.itemKey);
		await saveItemDraft(db, {
			expectedDraftRevision: secondRestoreOpened.draftRevision,
			expectedPayload: secondRestoreOpened.payload,
			itemKey: staleDraft.itemKey,
			payload: {
				...secondRestoreOpened.payload,
				title: "Restored again",
			},
		});
		await publishItemDraft(db, staleDraft.itemKey);
		const olderUpsert =
			await processNextSourceWritebackJob(consumerOptions);
		assert(
			olderUpsert.status === "processed" &&
				calls.at(-1)?.payload.title === "Restored again",
			"An older compatible upsert did not send the latest canonical state",
		);
		const queuedBeforeRestore =
			await processNextSourceWritebackJob(consumerOptions);
		assert(
			queuedBeforeRestore.status === "superseded",
			"An obsolete delete was sent after the item had been restored",
		);

		const [restoreJob] = await db
			.select()
			.from(sourceWritebackJob)
			.where(
				and(
					eq(sourceWritebackJob.itemKey, staleDraft.itemKey),
					isNull(sourceWritebackJob.processedAt),
				),
			)
			.orderBy(sourceWritebackJob.id)
			.limit(1);
		assert(restoreJob, "The restored item did not retain a pending upsert");
		await db
			.update(sourceWritebackJob)
			.set({
				leaseExpiresAt: new Date(0),
				leaseOwner: "expired-worker",
			})
			.where(eq(sourceWritebackJob.id, restoreJob.id));
		const recoveredExpiredLease =
			await processNextSourceWritebackJob(consumerOptions);
		assert(
			recoveredExpiredLease.status === "processed",
			"An expired worker lease prevented writeback recovery",
		);

		const imported = await writeSourceIngestionBatch(db, {
			collections: [],
			expectedCursor: {},
			fetchedAt: new Date(),
			items: [
				{
					metadata: {
						abstractNote: "Remote abstract",
						itemType: "Report",
						title: "Remote title",
					},
					operation: "upsert",
					raw: { key: "IMPT2345", version: 10 },
					remoteVersion: "10",
					sourceRecordKey: "IMPT2345",
				},
			],
			mappingProfileVersion: "zotero-v1",
			nextCursor: { version: 10 },
			sourceConnectionKey: connectionKey,
		});
		const importedItemKey = imported.itemKeys.IMPT2345!;
		createdItemKeys.push(importedItemKey);
		await db
			.update(itemSourceLink)
			.set({ writebackEnabled: true })
			.where(eq(itemSourceLink.itemKey, importedItemKey));
		const importedOpened = await openItemDraft(
			db,
			importedItemKey,
			writebackPolicyOptions,
		);
		await saveItemDraft(
			db,
			{
				expectedDraftRevision: importedOpened.draftRevision,
				expectedPayload: importedOpened.payload,
				itemKey: importedItemKey,
				payload: {
					...importedOpened.payload,
					title: "Locally edited import",
				},
			},
			writebackPolicyOptions,
		);
		await publishItemDraft(db, importedItemKey, writebackPolicyOptions);
		await db
			.update(sourceConnection)
			.set({ status: "paused" })
			.where(eq(sourceConnection.key, connectionKey));
		const pausedNativeDraft = await createNativeItemDraft(db, {
			itemType: "report",
			title: "Created while writeback is paused",
		});
		createdItemKeys.push(pausedNativeDraft.itemKey);
		await publishItemDraftWithContext(
			db,
			pausedNativeDraft.itemKey,
			publishToSource,
		);
		const [pausedNativeLink] = await db
			.select()
			.from(itemSourceLink)
			.where(eq(itemSourceLink.itemKey, pausedNativeDraft.itemKey));
		assert(
			pausedNativeLink?.sourceConnectionKey === connectionKey &&
				pausedNativeLink.writebackEnabled,
			"Publishing while the chosen source was paused stranded a native item without a writeback link",
		);
		const deferred = await processNextSourceWritebackJob(consumerOptions);
		const [deferredJob] = await db
			.select({ attempts: sourceWritebackJob.attempts })
			.from(sourceWritebackJob)
			.where(eq(sourceWritebackJob.id, deferred.jobId!));
		assert(
			deferred.status === "deferred" && deferredJob?.attempts === 0,
			"A paused source consumed retry attempts or discarded its pending write",
		);
		await db
			.update(sourceConnection)
			.set({ status: "active" })
			.where(eq(sourceConnection.key, connectionKey));
		await db
			.update(sourceWritebackJob)
			.set({ nextAttemptAt: new Date(0) })
			.where(eq(sourceWritebackJob.id, deferred.jobId!));
		sourceGateEnabled = false;
		const gateDeferred =
			await processNextSourceWritebackJob(consumerOptions);
		const [gateDeferredJob] = await db
			.select({
				attempts: sourceWritebackJob.attempts,
				lastError: sourceWritebackJob.lastError,
			})
			.from(sourceWritebackJob)
			.where(eq(sourceWritebackJob.id, deferred.jobId!));
		assert(
			gateDeferred.status === "deferred" &&
				gateDeferredJob?.attempts === 0 &&
				gateDeferredJob.lastError ===
					"Writeback is disabled for this source",
			"A disabled source gate consumed attempts or discarded its pending write",
		);
		sourceGateEnabled = true;
		await db
			.update(sourceWritebackJob)
			.set({ nextAttemptAt: new Date(0) })
			.where(eq(sourceWritebackJob.id, deferred.jobId!));
		const workerController = new AbortController();
		const workerResult = await runSourceWritebackWorker({
			...consumerOptions,
			maxJobsPerSweep: 10,
			signal: workerController.signal,
		});
		const importedCall = calls
			.toReversed()
			.find(
				(request) =>
					request.entity === "item" &&
					request.itemKey === importedItemKey,
			);
		assert(
			workerResult.lastSweep?.some(
				({ status }) => status === "processed",
			) &&
				importedCall?.entity === "item" &&
				importedCall.itemKey === importedItemKey &&
				importedCall.sourceRecordKey === "IMPT2345" &&
				importedCall.remoteVersion === "10" &&
				importedCall.payload.title === "Locally edited import",
			"The worker did not route an imported edit with its remote identity and version",
		);

		const [latestImportedJob] = await db
			.select()
			.from(sourceWritebackJob)
			.where(eq(sourceWritebackJob.itemKey, importedItemKey))
			.orderBy(sourceWritebackJob.id)
			.limit(1);
		assert(
			latestImportedJob,
			"The imported writeback job was not persisted",
		);
		await db.transaction(async (transaction) => {
			const duplicate = {
				canonicalRevision: latestImportedJob.canonicalRevision,
				dirtyFields: latestImportedJob.dirtyFields,
				itemKey: importedItemKey,
				operation: latestImportedJob.operation,
				sourceConnectionKey: connectionKey,
			};
			await enqueueSourceWritebackJob(transaction, duplicate);
			await enqueueSourceWritebackJob(transaction, duplicate);
		});
		const duplicateRows = await db
			.select({ id: sourceWritebackJob.id })
			.from(sourceWritebackJob)
			.where(
				and(
					eq(sourceWritebackJob.itemKey, importedItemKey),
					eq(
						sourceWritebackJob.canonicalRevision,
						latestImportedJob.canonicalRevision,
					),
				),
			);
		assert(
			duplicateRows.length === 1,
			"Duplicate enqueue calls created more than one revision job",
		);

		// Turning a source back on checks it first. Unchanged: updates resume.
		// Changed while paused: the link stops in "conflict" until the admin
		// chooses to send this record or load the source's copy.
		const conflictDraft = await createNativeItemDraft(db, {
			itemType: "report",
			title: "Paused, then checked again",
		});
		createdItemKeys.push(conflictDraft.itemKey);
		await publishItemDraftWithContext(
			db,
			conflictDraft.itemKey,
			publishToSource,
		);
		behavior = "success";
		const firstConflictSend =
			await processNextSourceWritebackJob(consumerOptions);
		assert(
			firstConflictSend.status === "processed",
			"The record chosen for the conflict scenario did not reach the source",
		);
		const conflictConfig = writebackPolicyOptions.writebackConfig;
		await setAdminItemWritebackSources(
			db,
			conflictDraft.itemKey,
			[],
			conflictConfig,
		);
		await setAdminItemWritebackSources(
			db,
			conflictDraft.itemKey,
			[connectionKey],
			conflictConfig,
		);
		const [recheckLink] = await db
			.select()
			.from(itemSourceLink)
			.where(eq(itemSourceLink.itemKey, conflictDraft.itemKey));
		assert(
			recheckLink?.writebackEnabled && recheckLink.remoteCheckRequired,
			"Turning a linked source back on did not ask the worker to check it first",
		);
		const resumed = await processNextSourceWritebackJob(consumerOptions);
		const [resumedLink] = await db
			.select()
			.from(itemSourceLink)
			.where(eq(itemSourceLink.itemKey, conflictDraft.itemKey));
		assert(
			resumed.status === "processed" &&
				resumedLink?.remoteCheckRequired === false &&
				resumedLink.conflictRemoteVersion === null,
			`An unchanged source did not simply resume after the check: ${JSON.stringify({ resumed, resumedLink, version })}`,
		);

		await setAdminItemWritebackSources(
			db,
			conflictDraft.itemKey,
			[],
			conflictConfig,
		);
		fakeRemote.version = () => "999";
		await setAdminItemWritebackSources(
			db,
			conflictDraft.itemKey,
			[connectionKey],
			conflictConfig,
		);
		const callsBeforeConflict = calls.length;
		const checked = await processNextSourceWritebackJob(consumerOptions);
		const conflictStatus = await getAdminSourceWritebackStatus(
			db,
			conflictDraft.itemKey,
			connectionKey,
			conflictConfig,
		);
		assert(
			checked.status === "conflict" &&
				conflictStatus.state === "conflict" &&
				calls.length === callsBeforeConflict,
			"A source that changed while paused did not stop in the conflict state",
		);
		const conflictEdit = await openItemDraft(db, conflictDraft.itemKey);
		await saveItemDraft(db, {
			expectedDraftRevision: conflictEdit.draftRevision,
			expectedPayload: conflictEdit.payload,
			itemKey: conflictDraft.itemKey,
			payload: { ...conflictEdit.payload, title: "Edited during conflict" },
		});
		await publishItemDraft(db, conflictDraft.itemKey);
		const blockedSend = await processNextSourceWritebackJob(consumerOptions);
		assert(
			blockedSend.status === "superseded" &&
				calls.length === callsBeforeConflict,
			"A publish during an unresolved conflict was sent to the source",
		);

		const sendLocal = await resolveAdminSourceWritebackConflict(
			db,
			conflictDraft.itemKey,
			connectionKey,
			"send-local",
			conflictConfig,
			{ credentialResolver: async () => "fake", registry },
		);
		fakeRemote.version = null;
		const sentLocal = await processNextSourceWritebackJob(consumerOptions);
		const sentStatus = await getAdminSourceWritebackStatus(
			db,
			conflictDraft.itemKey,
			connectionKey,
			conflictConfig,
		);
		assert(
			sendLocal.state === "queued" &&
				sentLocal.status === "processed" &&
				sentStatus.state === "synced" &&
				calls.at(-1)?.payload.title === "Edited during conflict",
			"Choosing to send this record did not overwrite the source copy",
		);

		await setAdminItemWritebackSources(
			db,
			conflictDraft.itemKey,
			[],
			conflictConfig,
		);
		fakeRemote.version = () => "1000";
		await setAdminItemWritebackSources(
			db,
			conflictDraft.itemKey,
			[connectionKey],
			conflictConfig,
		);
		const secondCheck = await processNextSourceWritebackJob(consumerOptions);
		assert(
			secondCheck.status === "conflict",
			"The second remote change was not detected as a conflict",
		);
		fakeRemote.record = {
			mappingProfileVersion: "fake-writeback-v1",
			record: {
				aliases: [],
				collections: [],
				file: null,
				metadata: {
					abstractNote: "Written at the source",
					itemType: "Report",
					title: "Source title wins",
				},
				operation: "upsert",
				parentSourceRecordKey: null,
				processingIssue: null,
				raw: { key: conflictDraft.itemKey, version: 1000 },
				remoteVersion: "1000",
				sourceDates: null,
				sourceRecordKey: conflictDraft.itemKey,
			},
		};
		const loadRemote = await resolveAdminSourceWritebackConflict(
			db,
			conflictDraft.itemKey,
			connectionKey,
			"load-remote",
			conflictConfig,
			{ credentialResolver: async () => "fake", registry },
		);
		fakeRemote.record = null;
		fakeRemote.version = null;
		const [loadedItem] = await db
			.select({ title: item.title })
			.from(item)
			.where(eq(item.key, conflictDraft.itemKey));
		const [loadedLink] = await db
			.select()
			.from(itemSourceLink)
			.where(eq(itemSourceLink.itemKey, conflictDraft.itemKey));
		assert(
			loadRemote.state === "synced" &&
				loadedItem?.title === "Source title wins" &&
				loadedLink?.conflictRemoteVersion === null &&
				loadedLink.lastAcknowledgedRemoteVersion === "1000",
			"Choosing to load the source's version did not replace this record",
		);

		console.log(
			JSON.stringify(
				{
					adapterCalls: calls.length,
					connectionKey,
					items: createdItemKeys.length,
					status: "ok",
				},
				null,
				2,
			),
		);
	} finally {
		releaseBlocked();
		if (createdItemKeys.length > 0) {
			await db
				.delete(itemDraft)
				.where(inArray(itemDraft.itemKey, createdItemKeys));
			await db
				.delete(itemToTag)
				.where(inArray(itemToTag.itemKey, createdItemKeys));
			await db
				.delete(itemToCollection)
				.where(inArray(itemToCollection.itemKey, createdItemKeys));
			await db
				.delete(outbox)
				.where(
					and(
						eq(outbox.entityType, "item"),
						inArray(outbox.entityKey, createdItemKeys),
					),
				);
			await db.delete(item).where(inArray(item.key, createdItemKeys));
			await db
				.delete(itemSourceLink)
				.where(inArray(itemSourceLink.itemKey, createdItemKeys));
			await db
				.delete(itemIdentity)
				.where(inArray(itemIdentity.key, createdItemKeys));
		}
		await db
			.delete(sourceConnection)
			.where(eq(sourceConnection.key, connectionKey));
		await resource.dispose();
	}
}

verify().catch(async (error) => {
	await delay(0);
	console.error(error);
	process.exitCode = 1;
});
