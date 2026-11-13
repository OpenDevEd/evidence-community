import { libraryConfigSchema } from "../src/config/library-config/schema";
import { maximalLibraryConfig } from "../tests/fixtures/library-config";
import {
	collectionIdentity,
	itemIdentity,
	outbox,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import {
	publicationIdentifier,
	publicationSyncState,
	publicationTarget,
} from "../src/db/schema/publication";
import { collection } from "../src/db/schema/tables/collection";
import { item } from "../src/db/schema/tables/item";
import { itemToCollection } from "../src/db/schema/tables/itemToCollection";
import { itemToTag } from "../src/db/schema/tables/itemToTag";
import { tag } from "../src/db/schema/tables/tag";
import { NATIVE_COLLECTION_SORT_ORDER_STEP } from "../src/lib/admin/native-collection-service";
import {
	applySearchProjectionPlan,
	drainSearchOutbox,
	processNextSearchOutboxBatch,
	processNextSearchOutboxEvent,
	requeueSearchOutboxDeadLetters,
	rebuildForOutboxBacklog,
	rebuildSearchIndex,
	SearchIndexDocumentError,
	SearchOutboxAbortError,
	SearchOutboxLeaseLostError,
	type SearchOutboxProgress,
} from "../src/lib/search-index/consumer";
import type { SearchProjectionPlan } from "../src/lib/search-index/projection";
import { PLATFORM_SEARCH_SCOPE_OPTIONS } from "../src/config/library-config/catalogs";
import { outboxVerifierEngine } from "./search-outbox-engines";

const libraryConfig = libraryConfigSchema.parse(maximalLibraryConfig);

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;

const parentKey = "SRCH2345";
const keptKey = "LEAS2345";
const stolenKey = "STLN2345";
const attachmentKey = "ATCH2345";
const reparentedKey = "REPR2345";
const firstRootKey = "FRTS2345";
const secondRootKey = "SCND2345";
const childCollectionKey = "CHLD2345";
const entityKeys = [
	parentKey,
	keptKey,
	stolenKey,
	attachmentKey,
	reparentedKey,
	firstRootKey,
	secondRootKey,
	childCollectionKey,
];
const backlogKey = "BKLG2345";
entityKeys.push(backlogKey);
// Stays public through the rebuild race check, so that rebuild has a record to write.
const raceKey = "RACE2345";
entityKeys.push(raceKey);
const tagName = "search-e2e";
const goodIndexName = `search_outbox_e2e_${process.pid}`;
const badIndexName = `search_outbox_bad_e2e_${process.pid}`;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function cleanupDatabase(
	database: ReturnType<typeof createPostgresDatabaseResource>["database"],
) {
	await database.delete(outbox).where(inArray(outbox.entityKey, entityKeys));
	await database
		.delete(publicationIdentifier)
		.where(inArray(publicationIdentifier.itemKey, entityKeys));
	await database
		.delete(publicationSyncState)
		.where(inArray(publicationSyncState.itemKey, entityKeys));
	await database
		.delete(publicationTarget)
		.where(inArray(publicationTarget.itemKey, entityKeys));
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
	const testLock = await resource.pool.connect();
	await testLock.query(
		"select pg_advisory_lock(hashtextextended('search-index-verifier', 0))",
	);
	const database = resource.database;
	const engine = outboxVerifierEngine(goodIndexName, badIndexName);
	const delayedExistingEvents: Array<{
		id: number;
		nextAttemptAt: Date;
	}> = [];

	try {
		await cleanupDatabase(database);
		await engine.reset();
		await engine.prepare();

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
				abstractNote: "A searchable local projection about Morocco and the United Kingdom",
				creators: [
					{
						creatorType: "author",
						firstName: "Amina",
						lastName: "Search",
					},
				],
				date: "2026",
				publisher: "OpenDevEd|Evidence Lab",
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
		await database.insert(publicationTarget).values([
			{
				environment: "test",
				itemKey: parentKey,
				provider: "crossref",
				requestedBy: "search-index-verifier",
			},
			{
				environment: "sandbox",
				identifierPolicy: "reuse-crossref",
				itemKey: parentKey,
				provider: "zenodo",
				requestedBy: "search-index-verifier",
			},
		]);
		await database.insert(publicationIdentifier).values([
			{
				doi: "10.53832/search.000001",
				environment: "test",
				isCurrent: true,
				itemKey: parentKey,
				lifecycle: "verified",
				ownership: "managed",
				registrar: "crossref",
				role: "primary",
				verifiedAt: new Date(),
			},
			{
				doi: "10.53832/search.000001",
				environment: "sandbox",
				isCurrent: true,
				itemKey: parentKey,
				lifecycle: "verified",
				ownership: "managed",
				registrar: "zenodo",
				role: "version",
				verifiedAt: new Date(),
			},
		]);
		await database.insert(publicationSyncState).values({
			environment: "sandbox",
			identifierPolicy: "reuse-crossref",
			itemKey: parentKey,
			provider: "zenodo",
			zenodoFirstPublishedAt: new Date(),
			zenodoParentId: "700000",
			zenodoRecordId: "700001",
			zenodoVersionDoi: "10.53832/search.000001",
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

		const observedProgress: SearchOutboxProgress[] = [];
		const changedPages: string[] = [];
		const initialBatch = await drainSearchOutbox({
 config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
			leaseDurationMs: 1_000,
			maxEvents: 2,
			onProgress: async (progress) => {
				observedProgress.push(progress);
			},
			onPagesChanged: (recordKeys) => changedPages.push(...recordKeys),
			taskTimeoutMs: 10_000,
			workerId: "search-e2e-initial",
		});
		// What a search engine is told: the record, once, and never its attachment, which has no page.
		assert(
			changedPages.length === 1 && changedPages[0] === parentKey,
			`The claim named the wrong pages as changed: ${JSON.stringify(changedPages)}`,
		);
		assert(
			initialBatch.length === 1 &&
				initialBatch[0]?.eventIds.length === 2 &&
				initialBatch[0].documentCount === 1,
			`Bulk outbox delivery did not coalesce parent and child events: ${JSON.stringify(initialBatch)}`,
		);
		// Meilisearch reports the task that indexes the claim; an Elasticsearch write has no task to report.
		assert(
			observedProgress[0]?.stage === "projecting" &&
				(engine.name === "elasticsearch" ||
					observedProgress.some(({ eventIds, stage, taskUid }) => stage === "indexing" && eventIds.length === 2 && taskUid !== null)),
			`The consumer did not report the claimed events' progress: ${JSON.stringify(observedProgress)}`,
		);
		const initialDocument = await engine.readDocument<{
            country: string[];
			attachmentsData: Array<{ key: string; tags: string[] }>;
			collections: string[];
			collectionsAncestry: string[];
			dateSortKey: number;
			fullTextPDFs: Array<{
				fullTextPDF: Array<{ page: number; text: string }>;
				key: string;
			}>;
			fullNames: string[];
			key: string;
			metadataSearch: string[];
			provider: string;
			publicationIdentifiers: {
				crossref: { doi: string; lifecycle: string };
				zenodo: {
					baseUrl: string;
					conceptRecordId: string;
					recordId: string;
					versionDoi: string;
				};
			};
			revision: number;
			tags: string[];
			year: string;
		}>(parentKey);
		assert(
			initialDocument.country.join(",") === "GB,MA" &&
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
				initialDocument.year === "2026" &&
				initialDocument.dateSortKey === 20260000 &&
				initialDocument.metadataSearch.includes("Initial indexed report") &&
				initialDocument.metadataSearch.includes("OpenDevEd|Evidence Lab"),
			"Derived search fields were not projected",
		);
		assert(
			initialDocument.attachmentsData[0]?.key === attachmentKey &&
				initialDocument.attachmentsData[0].tags.includes(tagName) &&
				initialDocument.fullTextPDFs[0]?.fullTextPDF[1]?.page === 2,
			"Attachment metadata and page text were not projected",
		);
		const fullTextScope = PLATFORM_SEARCH_SCOPE_OPTIONS.find(
			({ key }) => key === "documents",
		);
		assert(fullTextScope, "The full-text search scope is missing");
		const fullTextFields = fullTextScope.attributesToSearchOn;
		assert(
			(await engine.searchKeys("Second page text", fullTextFields, true)).join(",") === parentKey,
			"Full-text search did not return the publication containing the matching PDF page",
		);
		assert(
			(await engine.searchKeys("Initial indexed report", fullTextFields, true)).length === 0,
			"Full-text-only search matched metadata outside the PDF",
		);
		const textlessKey = "TEXTLESS2345";
		await engine.addDocuments([{ ...initialDocument, key: textlessKey, fullTextPDFs: [] }]);
		assert(
			(await engine.searchKeys("Initial indexed report", ["title"], true)).join(",") === parentKey,
			"Requiring PDF text did not exclude a matching record without extracted pages",
		);
		await engine.deleteDocument(textlessKey);
		assert(
			initialDocument.publicationIdentifiers.crossref.doi ===
				"10.53832/search.000001" &&
				initialDocument.publicationIdentifiers.crossref.lifecycle ===
					"verified" &&
				initialDocument.publicationIdentifiers.zenodo.versionDoi ===
					"10.53832/search.000001" &&
				initialDocument.publicationIdentifiers.zenodo.recordId ===
					"700001" &&
				initialDocument.publicationIdentifiers.zenodo.conceptRecordId ===
					"700000" &&
				initialDocument.publicationIdentifiers.zenodo.baseUrl ===
					"https://sandbox.zenodo.org",
			"Managed publication identifiers were not projected",
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
		const standaloneResult = await processNextSearchOutboxEvent({
 config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
			leaseDurationMs: 1_000,
			workerId: "search-e2e-standalone",
		});
		assert(
			standaloneResult?.eventIds.length === 1,
			`The standalone event was not processed alone: ${JSON.stringify(standaloneResult)}`,
		);
		// A parentless attachment is not a public record, so it must stay out
		// of the search index even when its own event is processed.
		assert(await engine.documentMissing(reparentedKey), "A parentless attachment was indexed on its own");
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
		const reparentedPages: string[] = [];
		const reparentResult = await processNextSearchOutboxEvent({
 config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
			leaseDurationMs: 1_000,
			onPagesChanged: (recordKeys) => reparentedPages.push(...recordKeys),
			workerId: "search-e2e-reparent",
		});
		// The item that became a child lost its page. Its key is removed from the index, and now names no record.
		assert(
			reparentedPages.length === 1 && reparentedPages[0] === parentKey,
			`The re-parent event named the wrong pages as changed: ${JSON.stringify(reparentedPages)}`,
		);
		assert(
			reparentResult?.eventIds.length === 1 &&
				reparentResult.deleteCount === 1 &&
				reparentResult.documentCount === 1,
			`The re-parent event produced the wrong projection: ${JSON.stringify(reparentResult)}`,
		);
		assert(await engine.documentMissing(reparentedKey), "The standalone document survived re-parenting");
		const reparentedParent = await engine.readDocument<{
			attachmentsData: Array<{ key: string }>;
		}>(parentKey);
		assert(
			reparentedParent.attachmentsData.some(
				(attachment) => attachment.key === reparentedKey,
			),
			"The re-parented child was not embedded in its parent",
		);
		const sizedBatchKeys = ["BTCH2345", "BTCH2346", "BTCH2347"];
		const sizedBatchDocuments = sizedBatchKeys.map((key) => ({
			...reparentedParent,
			abstractNote: "x".repeat(2_000),
			key,
		})) as unknown as SearchProjectionPlan["documents"];
		const counted = engine.intercept(async () => undefined);
		await applySearchProjectionPlan(
			counted.writer,
			{ deleteKeys: [], documents: sizedBatchDocuments },
			10_000,
			1_024,
		);
		assert(
			counted.writeCalls() === sizedBatchDocuments.length,
			"Serialized-size batching did not split oversized batches",
		);
		await applySearchProjectionPlan(
			engine.writer(),
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
 config: libraryConfig,
				database,
				heartbeatIntervalMs: 100,
				writer: engine.refusingWriter(),
				leaseDurationMs: 1_000,
				retryBaseMs: 100,
				taskTimeoutMs: 10_000,
				workerId: "search-e2e-failure",
			});
			throw new Error(
				"The refused write unexpectedly succeeded",
			);
		} catch (error) {
			assert(
				error instanceof SearchIndexDocumentError,
				"The worker did not report the record Elasticsearch refused",
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
				/SearchIndex(Document|Task)Error/u.test(failedEvent.lastError ?? "") &&
				failedEvent.leaseOwner === null,
			"A refused write was acknowledged or did not become retryable",
		);
		await database
			.update(outbox)
			.set({ nextAttemptAt: new Date() })
			.where(eq(outbox.id, retryEvent.id));
		await processNextSearchOutboxEvent({
 config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
			leaseDurationMs: 1_000,
			workerId: "search-e2e-retry",
		});
		const retriedDocument = await engine.readDocument<{
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
 config: libraryConfig,
				database,
				heartbeatIntervalMs: 100,
				writer: engine.refusingWriter(),
				leaseDurationMs: 1_000,
				maxAttempts: 1,
				retryBaseMs: 100,
				workerId: "search-e2e-dead-letter",
			});
			throw new Error("The poison event unexpectedly succeeded");
		} catch (error) {
			assert(
				error instanceof SearchIndexDocumentError,
				`The poison event failed for an unexpected reason: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
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
		assert(requeued.length === 1, "The dead letter was not requeued");
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
 config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
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
 config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
			leaseDurationMs: 1_000,
			workerId: "search-e2e-collection",
		});
		const movedDocument = await engine.readDocument<{
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
 config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
			leaseDurationMs: 1_000,
			workerId: "search-e2e-delete",
		});
		assert(await engine.documentMissing(parentKey), "The tombstoned document remains searchable");

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
 config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
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
 config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
			leaseDurationMs: 1_000,
			workerId: "search-e2e-contender",
		});
		assert(unavailable === null, "A valid outbox lease was stolen");
		await database
			.update(outbox)
			.set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
			.where(eq(outbox.id, leasedEvent.id));
		await processNextSearchOutboxEvent({
 config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
			leaseDurationMs: 1_000,
			workerId: "search-e2e-replacement",
		});
		await processNextSearchOutboxEvent({
 config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
			leaseDurationMs: 1_000,
			workerId: "search-e2e-serialized-follower",
		});
		const recoveredDocument = await engine.readDocument<{
			revision: number;
			title: string;
		}>(parentKey);
		assert(
			recoveredDocument.revision === 7 &&
				recoveredDocument.title === "Serialized lease recovery report",
			"Expired-lease recovery did not preserve entity ordering",
		);

		await database
			.update(item)
			.set({ revision: 8, title: "Interrupted indexing report" })
			.where(eq(item.key, parentKey));
		const [interruptedEvent] = await database
			.insert(outbox)
			.values({
				entityKey: parentKey,
				entityType: "item",
				operation: "upsert",
				revision: 8,
			})
			.returning();
		assert(interruptedEvent, "The interrupted event was not created");
		const shutdown = new AbortController();
		let releaseWaitingProgress!: () => void;
		const waitingProgressHeld = new Promise<void>((resolve) => {
			releaseWaitingProgress = resolve;
		});
		let reportWaitingReached!: () => void;
		const waitingReached = new Promise<void>((resolve) => {
			reportWaitingReached = resolve;
		});
		const interruptedProcessing = processNextSearchOutboxEvent({
 config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
			leaseDurationMs: 1_000,
			// Hold the worker while Meilisearch indexes the claim; an Elasticsearch write reports no task, so hold it
			// just before the write.
			onProgress: async ({ stage }) => {
				if (stage === (engine.name === "meilisearch" ? "indexing" : "projecting")) {
					reportWaitingReached();
					await waitingProgressHeld;
				}
			},
			signal: shutdown.signal,
			workerId: "search-e2e-first-generation",
		});
		await waitingReached;
		const replacementWhileLeased = await processNextSearchOutboxEvent({
 config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
			leaseDurationMs: 1_000,
			workerId: "search-e2e-replacement-generation",
		});
		assert(
			replacementWhileLeased === null,
			"A replacement generation stole its predecessor's active lease",
		);
		shutdown.abort();
		releaseWaitingProgress();
		try {
			await interruptedProcessing;
			throw new Error("The active worker ignored its shutdown signal");
		} catch (error) {
			assert(
				error instanceof SearchOutboxAbortError,
				"Active shutdown failed for an unexpected reason",
			);
		}
		const [releasedEvent] = await database
			.select()
			.from(outbox)
			.where(eq(outbox.id, interruptedEvent.id));
		assert(
			releasedEvent?.processedAt === null &&
				releasedEvent.leaseOwner === null &&
				releasedEvent.leaseExpiresAt === null &&
				releasedEvent.attempts === 0,
			"Shutdown did not release the active event without penalizing it",
		);

		await processNextSearchOutboxEvent({
			config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
			leaseDurationMs: 1_000,
			workerId: "search-e2e-after-shutdown",
		});
		const recoveredAfterShutdown = await engine.readDocument<{
			revision: number;
			title: string;
		}>(parentKey);
		assert(
			recoveredAfterShutdown.revision === 8 &&
				recoveredAfterShutdown.title === "Interrupted indexing report",
			"The event released during shutdown was not retryable",
		);

		// The rebuild fills a new index from PostgreSQL, so a document with no
		// PostgreSQL record is left behind with the old index.
		const orphanKey = `${parentKey}ORPHAN`;
		await engine.addDocuments([{ key: orphanKey, title: "Orphaned search copy" }]);
		const rebuilt = await rebuildSearchIndex(database, engine.writer(), libraryConfig, {
			taskTimeoutMs: 60_000,
		});
		assert(
			rebuilt.indexed >= 1,
			"The full rebuild omitted the canonical item",
		);
		await engine.readDocument(parentKey);
		assert(await engine.documentMissing(orphanKey), "The full rebuild kept a record PostgreSQL no longer has");

		// A record unpublished when the rebuild reads it, then published again
		// and indexed into the old index by a running worker before the alias
		// moves, must be indexed again into the new index.
		await database.insert(itemIdentity).values({ key: raceKey, sourceConnectionKey: "native", sourceRecordKey: raceKey });
		await database.insert(item).values({
			itemType: "Report",
			key: raceKey,
			sourceConnectionKey: "native",
			sourceRecordKey: raceKey,
			title: "Public through the rebuild",
		});
		await database
			.update(item)
			.set({ deleted: 1, deletedAt: new Date(), revision: 9 })
			.where(eq(item.key, parentKey));
		let republishedDuringRebuild = false;
		const rebuildWithRepublish = engine.intercept(async () => {
			if (republishedDuringRebuild) return;
			republishedDuringRebuild = true;
			await database
				.update(item)
				.set({ deleted: 0, deletedAt: null, revision: 10 })
				.where(eq(item.key, parentKey));
			await database.insert(outbox).values({ entityKey: parentKey, entityType: "item", operation: "upsert", revision: 10 });
			await processNextSearchOutboxEvent({
				config: libraryConfig,
				database,
				heartbeatIntervalMs: 100,
				writer: engine.writer(),
				leaseDurationMs: 1_000,
				workerId: "search-e2e-during-rebuild",
			});
		});
		const raced = await rebuildSearchIndex(database, rebuildWithRepublish.writer, libraryConfig, { taskTimeoutMs: 60_000 });
		assert(
			republishedDuringRebuild && raced.redrained >= 1,
			"The rebuild did not put back an event acknowledged while it ran",
		);
		await processNextSearchOutboxEvent({
			config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
			leaseDurationMs: 1_000,
			workerId: "search-e2e-after-rebuild",
		});
		const republished = await engine.readDocument<{
			revision: number;
		}>(parentKey);
		assert(
			republished.revision === 10,
			"The full rebuild lost a record published again during the rebuild",
		);

		// A backlog rebuild acknowledges the events waiting before it and
		// leaves events written during it queued for the drain.
		await database
			.update(item)
			.set({ revision: 11, title: "Backlog report" })
			.where(eq(item.key, parentKey));
		const [waitingEvent] = await database
			.insert(outbox)
			.values({ entityKey: parentKey, entityType: "item", operation: "upsert", revision: 11 })
			.returning({ id: outbox.id });
		assert(waitingEvent, "The backlog event was not created");
		await database.insert(itemIdentity).values({
			key: backlogKey,
			sourceConnectionKey: "native",
			sourceRecordKey: backlogKey,
		});
		await database.insert(item).values({
			itemType: "Report",
			key: backlogKey,
			sourceConnectionKey: "native",
			sourceRecordKey: backlogKey,
			title: "Written during the rebuild",
		});
		// A renamed collection waits too: its records' pages changed, and no event names them.
		await database.insert(itemToCollection).values({ collectionKey: secondRootKey, itemKey: backlogKey });
		await database.update(collection).set({ name: "Second root, renamed", revision: 2 }).where(eq(collection.key, secondRootKey));
		await database.insert(outbox).values({ entityKey: secondRootKey, entityType: "collection", operation: "upsert", revision: 2 });
		const backlogPages: string[] = [];
		let lateEventId: number | undefined;
		const writeDuringRebuild = engine.intercept(async () => {
			if (lateEventId !== undefined) return;
			const [lateEvent] = await database
				.insert(outbox)
				.values({ entityKey: backlogKey, entityType: "item", operation: "upsert", revision: 1 })
				.returning({ id: outbox.id });
			lateEventId = lateEvent?.id;
		});
		const backlogRebuild = await rebuildForOutboxBacklog(
			database,
			writeDuringRebuild.writer,
			libraryConfig,
			{ onPagesChanged: (recordKeys) => backlogPages.push(...recordKeys), taskTimeoutMs: 60_000 },
		);
		assert(lateEventId !== undefined, "No event was written during the backlog rebuild");
		assert(
			[...new Set(backlogPages)].sort().join(",") === [backlogKey, parentKey].sort().join(","),
			`The backlog rebuild announced ${backlogPages.join(",")}, not the waiting record and the renamed collection's record`,
		);
		const [waitingAfter] = await database.select().from(outbox).where(eq(outbox.id, waitingEvent.id));
		const [lateAfter] = await database.select().from(outbox).where(eq(outbox.id, lateEventId));
		assert(
			backlogRebuild.acknowledged >= 1 && waitingAfter?.processedAt !== null,
			"The backlog rebuild did not acknowledge the event waiting before it",
		);
		assert(
			(await engine.readDocument<{ title: string }>(parentKey)).title === "Backlog report",
			"The backlog rebuild did not index the waiting event's change",
		);
		assert(
			lateAfter?.processedAt === null,
			"The backlog rebuild acknowledged an event written after it started",
		);
		await database.delete(outbox).where(eq(outbox.id, lateEventId));

		// A lease lost on one event must not strand the rest of its batch.
		// Before this check, the failure path rolled back every mark when one
		// row was gone, so siblings stayed leased until the lease expired.
		await database.insert(itemIdentity).values(
			[keptKey, stolenKey].map((key) => ({
				key,
				sourceConnectionKey: "native",
				sourceRecordKey: key,
			})),
		);
		await database.insert(item).values([
			{
				itemType: "Report",
				key: keptKey,
				sourceConnectionKey: "native",
				sourceRecordKey: keptKey,
				title: "Kept sibling report",
			},
			{
				itemType: "Report",
				key: stolenKey,
				sourceConnectionKey: "native",
				sourceRecordKey: stolenKey,
				title: "Stolen lease report",
			},
		]);
		const otherPending = await database
			.select({ id: outbox.id })
			.from(outbox)
			.where(
				and(
					inArray(outbox.entityKey, entityKeys),
					isNull(outbox.processedAt),
					isNull(outbox.deadLetteredAt),
				),
			);
		assert(
			otherPending.length === 0,
			"Earlier scenarios left pending events behind",
		);
		const [keptEvent, stolenEvent] = await database
			.insert(outbox)
			.values([
				{
					entityKey: keptKey,
					entityType: "item",
					operation: "upsert",
					revision: 1,
				},
				{
					entityKey: stolenKey,
					entityType: "item",
					operation: "upsert",
					revision: 1,
				},
			])
			.returning();
		assert(keptEvent && stolenEvent, "The lease-loss events were not created");
		const stealing = engine.intercept(async () => {
			await database
				.update(outbox)
				.set({ leaseOwner: "search-e2e-thief" })
				.where(eq(outbox.id, stolenEvent.id));
			throw new Error("search host went away");
		});
		try {
			await processNextSearchOutboxBatch({
 config: libraryConfig,
				database,
				heartbeatIntervalMs: 30_000,
				writer: stealing.writer,
				leaseDurationMs: 60_000,
				retryBaseMs: 100,
				workerId: "search-e2e-lease-loss",
			});
			throw new Error("The batch with a lost lease unexpectedly succeeded");
		} catch (error) {
			assert(
				error instanceof SearchOutboxLeaseLostError &&
					error.message.includes("search host went away"),
				"The lease-loss error did not name the failure behind it",
			);
		}
		const [keptRow] = await database
			.select()
			.from(outbox)
			.where(eq(outbox.id, keptEvent.id));
		assert(
			keptRow?.attempts === 1 &&
				keptRow.leaseOwner === null &&
				keptRow.lastError?.includes("search host went away"),
			"A lost lease on one event stranded its batch sibling",
		);
		await database
			.update(outbox)
			.set({ nextAttemptAt: new Date(Date.now() - 1_000) })
			.where(eq(outbox.id, keptEvent.id));
		await processNextSearchOutboxEvent({
 config: libraryConfig,
			database,
			heartbeatIntervalMs: 100,
			writer: engine.writer(),
			leaseDurationMs: 1_000,
			workerId: "search-e2e-lease-loss-retry",
		});
		const [keptAfterRetry] = await database
			.select({ processedAt: outbox.processedAt })
			.from(outbox)
			.where(eq(outbox.id, keptEvent.id));
		assert(
			keptAfterRetry?.processedAt instanceof Date,
			"The sibling event was not indexed on its retry",
		);
		const [stolenRow] = await database
			.select()
			.from(outbox)
			.where(eq(outbox.id, stolenEvent.id));
		assert(
			stolenRow?.leaseOwner === "search-e2e-thief" &&
				stolenRow.attempts === 0,
			"The failure path touched an event another worker owns",
		);

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
				gracefulActiveShutdown: true,
				engine: engine.name,
				index: goodIndexName,
				leaseLossIsolation: true,
				rebuildRace: true,
				reparentCleanup: true,
				retryAfterRefusedWrite: true,
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
		await engine.reset();
		await testLock.query(
			"select pg_advisory_unlock(hashtextextended('search-index-verifier', 0))",
		);
		testLock.release();
		await resource.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
