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
	openItemDraft,
	publishItemDraft,
	saveItemDraft,
	unpublishNativeItem,
} from "../src/lib/admin/native-item-service";
import type { JsonValue } from "../src/lib/source-ingestion/batch-schema";
import { sourcePayloadHash } from "../src/lib/source-ingestion/fingerprint";
import { writeSourceIngestionBatch } from "../src/lib/source-ingestion/transactional-writer";
import {
	SourceWritebackAdapterRegistry,
	type SourceWritebackRequest,
} from "../src/lib/source-writeback/adapter";
import {
	processNextSourceWritebackJob,
	type SourceWritebackConsumerOptions,
} from "../src/lib/source-writeback/consumer";
import { enqueueSourceWritebackJob } from "../src/lib/source-writeback/queue";
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
	let previousDefaultKeys: string[] = [];
	let behavior: "block" | "fail" | "success" = "success";
	let releaseBlocked = () => {};
	let markBlocked = () => {};
	let blocked = Promise.resolve();
	let version = 0;
	const calls: SourceWritebackRequest[] = [];

	const registry = new SourceWritebackAdapterRegistry([
		{
			provider: "zotero",
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
		workerId: `writeback-verifier-${marker}`,
	};

	try {
		previousDefaultKeys = (
			await db
				.select({ key: sourceConnection.key })
				.from(sourceConnection)
				.where(eq(sourceConnection.defaultWriteback, true))
		).map(({ key }) => key);
		if (previousDefaultKeys.length > 0) {
			await db
				.update(sourceConnection)
				.set({ defaultWriteback: false })
				.where(inArray(sourceConnection.key, previousDefaultKeys));
		}
		await db.insert(sourceConnection).values({
			credentialRef: "env:SOURCE_WRITEBACK_TEST_KEY",
			defaultWriteback: true,
			externalScopeKey: `writeback-${marker}`,
			key: connectionKey,
			provider: "zotero",
			scopeKind: "group",
		});

		const nativeDraft = await createNativeItemDraft(db, {
			abstractNote: "First abstract",
			itemType: "report",
			tags: ["writeback-test"],
			title: "First title",
		});
		createdItemKeys.push(nativeDraft.itemKey);
		const firstPublished = await publishItemDraft(db, nativeDraft.itemKey);
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
			"A native first publish did not attach to the default writeback target and queue creation",
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

		behavior = "success";
		const staleDraft = await createNativeItemDraft(db, {
			itemType: "report",
			title: "Never-created remote item",
		});
		createdItemKeys.push(staleDraft.itemKey);
		await publishItemDraft(db, staleDraft.itemKey);
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
		const importedOpened = await openItemDraft(db, importedItemKey);
		await saveItemDraft(db, {
			expectedDraftRevision: importedOpened.draftRevision,
			expectedPayload: importedOpened.payload,
			itemKey: importedItemKey,
			payload: {
				...importedOpened.payload,
				title: "Locally edited import",
			},
		});
		await publishItemDraft(db, importedItemKey);
		await db
			.update(sourceConnection)
			.set({ defaultWriteback: false })
			.where(eq(sourceConnection.key, connectionKey));
		await db
			.update(sourceConnection)
			.set({ status: "paused" })
			.where(eq(sourceConnection.key, connectionKey));
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
			.update(sourceConnection)
			.set({ defaultWriteback: true })
			.where(eq(sourceConnection.key, connectionKey));
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
		const importedCall = calls.at(-1)!;
		assert(
			workerResult.lastSweep?.some(
				({ status }) => status === "processed",
			) &&
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
			.update(sourceConnection)
			.set({ defaultWriteback: false })
			.where(eq(sourceConnection.key, connectionKey));
		await db
			.delete(sourceConnection)
			.where(eq(sourceConnection.key, connectionKey));
		if (previousDefaultKeys.length > 0) {
			await db
				.update(sourceConnection)
				.set({ defaultWriteback: true })
				.where(inArray(sourceConnection.key, previousDefaultKeys));
		}
		await resource.dispose();
	}
}

verify().catch(async (error) => {
	await delay(0);
	console.error(error);
	process.exitCode = 1;
});
