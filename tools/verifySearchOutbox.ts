import {
	collectionIdentity,
	itemIdentity,
	outbox,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { MeiliSearch, MeiliSearchApiError, type Task } from "meilisearch";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { collection } from "../src/db/schema/tables/collection";
import { item } from "../src/db/schema/tables/item";
import { itemToCollection } from "../src/db/schema/tables/itemToCollection";
import { itemToTag } from "../src/db/schema/tables/itemToTag";
import { tag } from "../src/db/schema/tables/tag";
import { NATIVE_COLLECTION_SORT_ORDER_STEP } from "../src/lib/admin/native-collection-service";
import type { MeilisearchService } from "../src/lib/meilisearch-factory";
import {
	applySearchProjectionPlan,
	drainSearchOutbox,
	ensureSearchIndex,
	processNextSearchOutboxEvent,
	requeueSearchOutboxDeadLetters,
	rebuildSearchIndex,
	SearchIndexTaskError,
} from "../src/lib/search-index/consumer";
import type { SearchProjectionPlan } from "../src/lib/search-index/projection";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;
const meilisearchHost =
	process.env.MEILISEARCH_HOST ?? "http://127.0.0.1:57700";
const meilisearchKey = process.env.MEILISEARCH_KEY ?? "local-search-key";

const parentKey = "SRCH2345";
const attachmentKey = "ATCH2345";
const reparentedKey = "REPR2345";
const firstRootKey = "FRTS2345";
const secondRootKey = "SCND2345";
const childCollectionKey = "CHLD2345";
const entityKeys = [
	parentKey,
	attachmentKey,
	reparentedKey,
	firstRootKey,
	secondRootKey,
	childCollectionKey,
];
const tagName = "search-e2e";
const goodIndexName = `search_outbox_e2e_${process.pid}`;
const badIndexName = `search_outbox_bad_e2e_${process.pid}`;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function service(client: MeiliSearch, indexName: string): MeilisearchService {
	return {
		cacheIndex: client.index("cache"),
		client,
		index: client.index(indexName),
		indexName,
		redirectsIndex: client.index("redirects"),
	};
}

async function successfulTask(taskPromise: { waitTask: () => Promise<Task> }) {
	const task = await taskPromise.waitTask();
	assert(
		task.status === "succeeded",
		`Meilisearch setup task ${task.uid} failed: ${task.error?.message}`,
	);
}

async function deleteIndexIfPresent(client: MeiliSearch, indexName: string) {
	try {
		await client.getRawIndex(indexName);
		await successfulTask(client.deleteIndex(indexName));
	} catch (error) {
		if (
			error instanceof MeiliSearchApiError &&
			error.cause?.code === "index_not_found"
		) {
			return;
		}
		throw error;
	}
}

async function cleanupDatabase(
	database: ReturnType<typeof createPostgresDatabaseResource>["database"],
) {
	await database.delete(outbox).where(inArray(outbox.entityKey, entityKeys));
	await database.delete(item).where(inArray(item.key, entityKeys));
	await database
		.delete(collection)
		.where(inArray(collection.key, entityKeys));
	await database
		.delete(itemIdentity)
		.where(inArray(itemIdentity.key, entityKeys));
	await database
		.delete(collectionIdentity)
		.where(inArray(collectionIdentity.key, entityKeys));
	await database.delete(tag).where(eq(tag.name, tagName));
}

async function verify() {
	const resource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const database = resource.database;
	const client = new MeiliSearch({
		apiKey: meilisearchKey,
		host: meilisearchHost,
	});
	const goodService = service(client, goodIndexName);
	const badService = service(client, badIndexName);
	const delayedExistingEvents: Array<{
		id: number;
		nextAttemptAt: Date;
	}> = [];

	try {
		await cleanupDatabase(database);
		await Promise.all([
			deleteIndexIfPresent(client, goodIndexName),
			deleteIndexIfPresent(client, badIndexName),
		]);
		await ensureSearchIndex(goodService);
		await successfulTask(
			client.createIndex(badIndexName, {
				primaryKey: "id",
			}),
		);

		const pending = await database
			.select({
				id: outbox.id,
				nextAttemptAt: outbox.nextAttemptAt,
			})
			.from(outbox)
			.where(
				and(isNull(outbox.processedAt), isNull(outbox.deadLetteredAt)),
			);
		delayedExistingEvents.push(...pending);
		if (pending.length > 0) {
			await database
				.update(outbox)
				.set({
					nextAttemptAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
				})
				.where(
					inArray(
						outbox.id,
						pending.map(({ id }) => id),
					),
				);
		}

		await database.insert(collectionIdentity).values(
			[firstRootKey, secondRootKey, childCollectionKey].map((key) => ({
				key,
				sourceConnectionKey: "native",
				sourceRecordKey: key,
			})),
		);
		await database.insert(collection).values([
			{
				key: firstRootKey,
				name: "First root",
				sortOrder: NATIVE_COLLECTION_SORT_ORDER_STEP,
				sourceConnectionKey: "native",
				sourceRecordKey: firstRootKey,
			},
			{
				key: secondRootKey,
				name: "Second root",
				sortOrder: NATIVE_COLLECTION_SORT_ORDER_STEP * 2,
				sourceConnectionKey: "native",
				sourceRecordKey: secondRootKey,
			},
			{
				key: childCollectionKey,
				name: "Child collection",
				parentCollection: firstRootKey,
				sortOrder: NATIVE_COLLECTION_SORT_ORDER_STEP,
				sourceConnectionKey: "native",
				sourceRecordKey: childCollectionKey,
			},
		]);
		await database.insert(itemIdentity).values(
			[parentKey, attachmentKey, reparentedKey].map((key) => ({
				key,
				sourceConnectionKey: "native",
				sourceRecordKey: key,
			})),
		);
		await database.insert(item).values([
			{
				abstractNote: "A searchable local projection",
				country: "MA|GB",
				creators: [
					{
						creatorType: "author",
						firstName: "Amina",
						lastName: "Search",
					},
				],
				date: "2026",
				institution: "OpenDevEd|Evidence Lab",
				itemType: "Report",
				key: parentKey,
				sourceConnectionKey: "native",
				sourceRecordKey: parentKey,
				title: "Initial indexed report",
			},
			{
				contentType: "application/pdf",
				filename: "search.pdf",
				fullTextPDF:
					"**|| PAGE 1 ||** First page text\n**|| PAGE 2 ||** Second page text",
				itemType: "Attachment",
				key: attachmentKey,
				parentItem: parentKey,
				sourceConnectionKey: "native",
				sourceRecordKey: attachmentKey,
				title: "Search attachment",
			},
			{
				contentType: "application/pdf",
				filename: "reparented.pdf",
				itemType: "Attachment",
				key: reparentedKey,
				sourceConnectionKey: "native",
				sourceRecordKey: reparentedKey,
				title: "Initially standalone attachment",
			},
		]);
		await database.insert(tag).values({ name: tagName });
		await database.insert(itemToTag).values([
			{ itemKey: parentKey, tagName },
			{ itemKey: attachmentKey, tagName },
		]);
		await database.insert(itemToCollection).values({
			collectionKey: childCollectionKey,
			itemKey: parentKey,
		});
		const [initialEvent] = await database
			.insert(outbox)
			.values({
				entityKey: parentKey,
				entityType: "item",
				operation: "upsert",
				revision: 1,
			})
			.returning();
		assert(initialEvent, "The initial outbox event was not created");
		const [attachmentEvent] = await database
			.insert(outbox)
			.values({
				entityKey: attachmentKey,
				entityType: "item",
				operation: "upsert",
				revision: 1,
			})
			.returning();
		assert(attachmentEvent, "The attachment outbox event was not created");

		const initialBatch = await drainSearchOutbox({
			database,
			heartbeatIntervalMs: 100,
			index: goodService.index,
			leaseDurationMs: 1_000,
			maxEvents: 2,
			taskTimeoutMs: 10_000,
			workerId: "search-e2e-initial",
		});
		assert(
			initialBatch.length === 1 &&
				initialBatch[0]?.eventIds.length === 2 &&
				initialBatch[0].documentCount === 1,
			"Bulk outbox delivery did not coalesce parent and child events",
		);
		const initialDocument = await goodService.index.getDocument<{
			attachmentsData: Array<{ key: string; tags: string[] }>;
			collections: string[];
			collectionsAncestry: string[];
			fullTextPDFs: Array<{
				fullTextPDF: Array<{ page: number; text: string }>;
				key: string;
			}>;
			fullNames: string[];
			key: string;
			provider: string;
			revision: number;
			tags: string[];
			year: string;
		}>(parentKey);
		assert(
			initialDocument.key === parentKey &&
				initialDocument.provider === "native" &&
				initialDocument.revision === 1,
			"The canonical identity was not projected",
		);
		assert(
			initialDocument.collections.join(",") === childCollectionKey &&
				initialDocument.collectionsAncestry.join(",") ===
					[firstRootKey, childCollectionKey].sort().join(","),
			"Collection membership and ancestry were not projected",
		);
		assert(
			initialDocument.tags.includes(tagName) &&
				initialDocument.fullNames.includes("Amina Search") &&
				initialDocument.year === "2026",
			"Derived search fields were not projected",
		);
		assert(
			initialDocument.attachmentsData[0]?.key === attachmentKey &&
				initialDocument.attachmentsData[0].tags.includes(tagName) &&
				initialDocument.fullTextPDFs[0]?.fullTextPDF[1]?.page === 2,
			"Attachment metadata and page text were not projected",
		);
		const [acknowledged] = await database
			.select()
			.from(outbox)
			.where(eq(outbox.id, initialEvent.id));
		assert(
			acknowledged?.processedAt && acknowledged.leaseOwner === null,
			"The event was not durably acknowledged",
		);
		const [attachmentAcknowledged] = await database
			.select()
			.from(outbox)
			.where(eq(outbox.id, attachmentEvent.id));
		assert(
			attachmentAcknowledged?.processedAt,
			"The coalesced child event was not acknowledged",
		);

		await database.insert(outbox).values({
			entityKey: reparentedKey,
			entityType: "item",
			operation: "upsert",
			revision: 1,
		});
		await processNextSearchOutboxEvent({
			database,
			heartbeatIntervalMs: 100,
			index: goodService.index,
			leaseDurationMs: 1_000,
			workerId: "search-e2e-standalone",
		});
		await goodService.index.getDocument(reparentedKey);
		await database
			.update(item)
			.set({ parentItem: parentKey, revision: 2 })
			.where(eq(item.key, reparentedKey));
		await database.insert(outbox).values({
			entityKey: reparentedKey,
			entityType: "item",
			operation: "upsert",
			revision: 2,
		});
		await processNextSearchOutboxEvent({
			database,
			heartbeatIntervalMs: 100,
			index: goodService.index,
			leaseDurationMs: 1_000,
			workerId: "search-e2e-reparent",
		});
		try {
			await goodService.index.getDocument(reparentedKey);
			throw new Error("The standalone document survived re-parenting");
		} catch (error) {
			assert(
				error instanceof MeiliSearchApiError &&
					error.cause?.code === "document_not_found",
				"Re-parent cleanup failed for an unexpected reason",
			);
		}
		const reparentedParent = await goodService.index.getDocument<{
			attachmentsData: Array<{ key: string }>;
		}>(parentKey);
		assert(
			reparentedParent.attachmentsData.some(
				(attachment) => attachment.key === reparentedKey,
			),
			"The re-parented child was not embedded in its parent",
		);
		const tasksBeforeSizedBatch = await client.tasks.getTasks({
			indexUids: [goodIndexName],
			limit: 1,
		});
		const sizedBatchKeys = ["BTCH2345", "BTCH2346", "BTCH2347"];
		const sizedBatchDocuments = sizedBatchKeys.map((key) => ({
			...reparentedParent,
			abstractNote: "x".repeat(2_000),
			key,
		})) as unknown as SearchProjectionPlan["documents"];
		await applySearchProjectionPlan(
			goodService.index,
			{ deleteKeys: [], documents: sizedBatchDocuments },
			10_000,
			1_024,
		);
		const tasksAfterSizedBatch = await client.tasks.getTasks({
			indexUids: [goodIndexName],
			limit: 1,
		});
		assert(
			tasksAfterSizedBatch.total - tasksBeforeSizedBatch.total ===
				sizedBatchDocuments.length,
			"Serialized-size batching did not split oversized batches",
		);
		await applySearchProjectionPlan(
			goodService.index,
			{ deleteKeys: sizedBatchKeys, documents: [] },
			10_000,
		);

		await database
			.update(item)
			.set({
				revision: 2,
				title: "Retry-safe indexed report",
			})
			.where(eq(item.key, parentKey));
		const [retryEvent] = await database
			.insert(outbox)
			.values({
				entityKey: parentKey,
				entityType: "item",
				operation: "upsert",
				revision: 2,
			})
			.returning();
		assert(retryEvent, "The retry event was not created");
		try {
			await processNextSearchOutboxEvent({
				database,
				heartbeatIntervalMs: 100,
				index: badService.index,
				leaseDurationMs: 1_000,
				retryBaseMs: 100,
				taskTimeoutMs: 10_000,
				workerId: "search-e2e-failure",
			});
			throw new Error(
				"The invalid Meilisearch task unexpectedly succeeded",
			);
		} catch (error) {
			assert(
				error instanceof SearchIndexTaskError,
				"The worker did not surface the terminal Meilisearch task failure",
			);
		}
		const [failedEvent] = await database
			.select()
			.from(outbox)
			.where(eq(outbox.id, retryEvent.id));
		assert(
			failedEvent?.processedAt === null &&
				failedEvent.deadLetteredAt === null &&
				failedEvent.attempts === 1 &&
				failedEvent.lastError?.includes("SearchIndexTaskError") &&
				failedEvent.leaseOwner === null,
			"A failed task was acknowledged or did not become retryable",
		);
		await database
			.update(outbox)
			.set({ nextAttemptAt: new Date() })
			.where(eq(outbox.id, retryEvent.id));
		await processNextSearchOutboxEvent({
			database,
			heartbeatIntervalMs: 100,
			index: goodService.index,
			leaseDurationMs: 1_000,
			workerId: "search-e2e-retry",
		});
		const retriedDocument = await goodService.index.getDocument<{
			title: string;
		}>(parentKey);
		assert(
			retriedDocument.title === "Retry-safe indexed report",
			"The successful retry did not update the search document",
		);

		await database
			.update(item)
			.set({ revision: 3, title: "Poison revision" })
			.where(eq(item.key, parentKey));
		const [deadLetterEvent] = await database
			.insert(outbox)
			.values({
				entityKey: parentKey,
				entityType: "item",
				operation: "upsert",
				revision: 3,
			})
			.returning();
		assert(deadLetterEvent, "The dead-letter event was not created");
		try {
			await processNextSearchOutboxEvent({
				database,
				heartbeatIntervalMs: 100,
				index: badService.index,
				leaseDurationMs: 1_000,
				maxAttempts: 1,
				retryBaseMs: 100,
				workerId: "search-e2e-dead-letter",
			});
			throw new Error("The poison event unexpectedly succeeded");
		} catch (error) {
			assert(
				error instanceof SearchIndexTaskError,
				"The poison event failed for an unexpected reason",
			);
		}
		const [deadLettered] = await database
			.select()
			.from(outbox)
			.where(eq(outbox.id, deadLetterEvent.id));
		assert(
			deadLettered?.deadLetteredAt &&
				deadLettered.processedAt === null &&
				deadLettered.attempts === 1,
			"Retry exhaustion did not dead-letter the event",
		);
		const requeued = await requeueSearchOutboxDeadLetters(database);
		assert(requeued === 1, "The dead letter was not requeued");
		const [resetDeadLetter] = await database
			.select()
			.from(outbox)
			.where(eq(outbox.id, deadLetterEvent.id));
		assert(
			resetDeadLetter?.attempts === 0 &&
				resetDeadLetter.deadLetteredAt === null &&
				resetDeadLetter.lastError === null,
			"The requeued dead letter retained terminal state",
		);
		await processNextSearchOutboxEvent({
			database,
			heartbeatIntervalMs: 100,
			index: goodService.index,
			leaseDurationMs: 1_000,
			workerId: "search-e2e-requeued",
		});

		await database
			.update(collection)
			.set({
				parentCollection: secondRootKey,
				revision: 2,
			})
			.where(eq(collection.key, childCollectionKey));
		await database.insert(outbox).values({
			entityKey: childCollectionKey,
			entityType: "collection",
			operation: "upsert",
			revision: 2,
		});
		await processNextSearchOutboxEvent({
			database,
			heartbeatIntervalMs: 100,
			index: goodService.index,
			leaseDurationMs: 1_000,
			workerId: "search-e2e-collection",
		});
		const movedDocument = await goodService.index.getDocument<{
			collectionsAncestry: string[];
			revision: number;
			title: string;
		}>(parentKey);
		assert(
			movedDocument.collectionsAncestry.includes(secondRootKey) &&
				!movedDocument.collectionsAncestry.includes(firstRootKey) &&
				movedDocument.revision === 3 &&
				movedDocument.title === "Poison revision",
			`A collection event did not reproject current affected items: ${JSON.stringify(movedDocument)}`,
		);

		await database
			.update(item)
			.set({ deleted: 1, deletedAt: new Date(), revision: 4 })
			.where(eq(item.key, parentKey));
		await database.insert(outbox).values({
			entityKey: parentKey,
			entityType: "item",
			operation: "delete",
			revision: 4,
		});
		await processNextSearchOutboxEvent({
			database,
			heartbeatIntervalMs: 100,
			index: goodService.index,
			leaseDurationMs: 1_000,
			workerId: "search-e2e-delete",
		});
		try {
			await goodService.index.getDocument(parentKey);
			throw new Error("The tombstoned document remains searchable");
		} catch (error) {
			assert(
				error instanceof MeiliSearchApiError &&
					error.cause?.code === "document_not_found",
				"The tombstone check failed for an unexpected reason",
			);
		}

		await database
			.update(item)
			.set({
				deleted: 0,
				deletedAt: null,
				revision: 5,
				title: "Restored report",
			})
			.where(eq(item.key, parentKey));
		await database.insert(outbox).values({
			entityKey: parentKey,
			entityType: "item",
			operation: "upsert",
			revision: 5,
		});
		await processNextSearchOutboxEvent({
			database,
			heartbeatIntervalMs: 100,
			index: goodService.index,
			leaseDurationMs: 1_000,
			workerId: "search-e2e-restore",
		});

		await database
			.update(item)
			.set({ revision: 6, title: "Lease recovery report" })
			.where(eq(item.key, parentKey));
		const [leasedEvent] = await database
			.insert(outbox)
			.values({
				entityKey: parentKey,
				entityType: "item",
				leaseExpiresAt: new Date(Date.now() + 60_000),
				leaseOwner: "dead-indexer",
				operation: "upsert",
				revision: 6,
			})
			.returning();
		assert(leasedEvent, "The leased event was not created");
		await database
			.update(item)
			.set({
				revision: 7,
				title: "Serialized lease recovery report",
			})
			.where(eq(item.key, parentKey));
		const [sameEntityFollower] = await database
			.insert(outbox)
			.values({
				entityKey: parentKey,
				entityType: "item",
				operation: "upsert",
				revision: 7,
			})
			.returning();
		assert(
			sameEntityFollower,
			"The same-entity follower event was not created",
		);
		const unavailable = await processNextSearchOutboxEvent({
			database,
			heartbeatIntervalMs: 100,
			index: goodService.index,
			leaseDurationMs: 1_000,
			workerId: "search-e2e-contender",
		});
		assert(unavailable === null, "A valid outbox lease was stolen");
		await database
			.update(outbox)
			.set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
			.where(eq(outbox.id, leasedEvent.id));
		await processNextSearchOutboxEvent({
			database,
			heartbeatIntervalMs: 100,
			index: goodService.index,
			leaseDurationMs: 1_000,
			workerId: "search-e2e-replacement",
		});
		await processNextSearchOutboxEvent({
			database,
			heartbeatIntervalMs: 100,
			index: goodService.index,
			leaseDurationMs: 1_000,
			workerId: "search-e2e-serialized-follower",
		});
		const recoveredDocument = await goodService.index.getDocument<{
			revision: number;
			title: string;
		}>(parentKey);
		assert(
			recoveredDocument.revision === 7 &&
				recoveredDocument.title === "Serialized lease recovery report",
			"Expired-lease recovery did not preserve entity ordering",
		);

		const rebuilt = await rebuildSearchIndex(database, goodService, 60_000);
		assert(
			rebuilt.indexed >= 1,
			"The full rebuild omitted the canonical item",
		);
		await goodService.index.getDocument(parentKey);

		console.log(
			JSON.stringify({
				bulkEventCoalescing: true,
				byteAwareBatching: true,
				collectionReprojection: true,
				deadLetter: true,
				deadLetterRequeue: true,
				entityLeaseSerialization: true,
				expiredLeaseRecovery: true,
				fullRebuild: true,
				index: goodIndexName,
				reparentCleanup: true,
				retryAfterTaskFailure: true,
			}),
		);
	} finally {
		await cleanupDatabase(database);
		for (const event of delayedExistingEvents) {
			await database
				.update(outbox)
				.set({ nextAttemptAt: event.nextAttemptAt })
				.where(eq(outbox.id, event.id));
		}
		await Promise.all([
			deleteIndexIfPresent(client, goodIndexName),
			deleteIndexIfPresent(client, badIndexName),
		]);
		await resource.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
