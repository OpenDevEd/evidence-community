import {
	collectionIdentity,
	itemDraft,
	itemFileDraft,
	itemIdentity,
	outbox,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import { and, count, eq, inArray, sql } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { reserveCollectionIdentities } from "../src/db/record-identity";
import { itemFilePublication } from "../src/db/schema/source";
import {
	publicationSyncJob,
	publicationTarget,
} from "../src/db/schema/publication";
import { collection } from "../src/db/schema/tables/collection";
import { adminItemListProjection } from "../src/db/schema/tables/adminItemListProjection";
import { item } from "../src/db/schema/tables/item";
import { itemToCollection } from "../src/db/schema/tables/itemToCollection";
import { itemToTag } from "../src/db/schema/tables/itemToTag";
import { tag } from "../src/db/schema/tables/tag";
import {
	assignItemDraftToCollection as assignNativeItemDraftToCollection,
	createNativeItemDraft,
	discardItemDraft as discardNativeItemDraft,
	ItemHasActivePublicationError,
	ItemDraftConflictError as NativeDraftConflictError,
	openItemDraft as openNativeItemDraft,
	publishItemDraft as publishNativeItemDraft,
	publishItemDraftWithContext as publishNativeItemDraftWithContext,
	removeNativeItem,
	saveItemDraft as saveNativeItemDraft,
	unpublishNativeItem,
} from "../src/lib/admin/native-item-service";
import { createNativeCollection } from "../src/lib/admin/native-collection-service";
import { NativeItemValidationError } from "../src/lib/admin/native-item-validation";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) {
	throw new Error("DATABASE_URL_POST is required");
}
const verifiedDatabaseUrl = databaseUrl;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

type VerificationDatabase = ReturnType<
	typeof createPostgresDatabaseResource
>["database"];

async function runBehindNativeItemBarrier(
	db: VerificationDatabase,
	observer: VerificationDatabase,
	itemKey: string,
	start: () => Promise<unknown>[],
) {
	let operations: Promise<unknown>[] = [];
	await db.transaction(async (transaction) => {
		await transaction.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${`item:${itemKey}`}, 0))`,
		);
		operations = start();
		let waiting = 0;
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const locks = await observer.execute<{ waiting: number }>(
				sql`select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted`,
			);
			waiting = Number(locks.rows[0]?.waiting ?? 0);
			if (waiting >= operations.length) break;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert(
			waiting >= operations.length,
			"Concurrent operations did not reach the advisory-lock barrier",
		);
	});
	return Promise.allSettled(operations);
}

async function verify() {
	const resource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const observerResource =
		createPostgresDatabaseResource(verifiedDatabaseUrl);
	const db = resource.database;
	const observer = observerResource.database;
	const createdKeys: string[] = [];
	const importedSourceKey = `verify-zotero-${process.pid}`;
	let importedSourceCreated = false;
	let importedCollectionKeys: string[] = [];
	let nativeCollectionKey: string | null = null;
	const tagMarker = `${process.pid}-${Date.now()}`;
	const draftTag = `verify-native-draft-${tagMarker}`;
	const publishedTag = `verify-native-published-${tagMarker}`;
	const secondTag = `verify-native-second-${tagMarker}`;
	const verificationTags = [publishedTag, secondTag];

	try {
		const draft = await createNativeItemDraft(db, {
			itemType: "book",
			title: "Draft-only title",
			creators: [{ creatorType: "author", name: "Example Author" }],
			tags: [draftTag],
		});
		createdKeys.push(draft.itemKey);
		const [draftProjection] = await db
			.select()
			.from(adminItemListProjection)
			.where(eq(adminItemListProjection.key, draft.itemKey));
		assert(
			draftProjection?.state === "draft" &&
				draftProjection.title === "Draft-only title" &&
				draftProjection.tags.includes(draftTag),
			"Draft creation did not synchronously refresh the admin list",
		);

		const [beforePublish] = await db
			.select()
			.from(item)
			.where(eq(item.key, draft.itemKey));
		assert(!beforePublish, "Draft leaked into the published item table");

		const saved = await saveNativeItemDraft(db, {
			itemKey: draft.itemKey,
			expectedDraftRevision: 1,
			expectedPayload: draft.payload,
			payload: {
				itemType: "Book",
				title: "First published title",
				creators: [{ creatorType: "author", name: "Example Author" }],
				tags: [publishedTag],
			},
		});
		assert(saved.draftRevision === 2, "Draft revision did not advance");
		const [savedProjection] = await db
			.select()
			.from(adminItemListProjection)
			.where(eq(adminItemListProjection.key, draft.itemKey));
		assert(
			savedProjection?.title === "First published title" &&
				savedProjection.tags.includes(publishedTag),
			"Draft save did not synchronously refresh projected metadata",
		);

		// A second session that loaded the draft before the save above and
		// changed a different field keeps both changes.
		const mergedSave = await saveNativeItemDraft(db, {
			itemKey: draft.itemKey,
			expectedDraftRevision: 1,
			expectedPayload: draft.payload,
			payload: { ...draft.payload, abstractNote: "Added in another tab" },
		});
		assert(
			mergedSave.draftRevision === 3 &&
				mergedSave.payload.title === "First published title" &&
				mergedSave.payload.abstractNote === "Added in another tab",
			`Concurrent edits to different fields were not merged: ${JSON.stringify(mergedSave.payload)}`,
		);

		// The same stale session changing the same field to a different value
		// is refused and names the field.
		let staleSaveRejected: string[] | null = null;
		try {
			await saveNativeItemDraft(db, {
				itemKey: draft.itemKey,
				expectedDraftRevision: 1,
				expectedPayload: draft.payload,
				payload: { ...draft.payload, title: "Stale edit" },
			});
		} catch (error) {
			if (error instanceof NativeDraftConflictError) {
				staleSaveRejected = [...error.fields];
			}
		}
		assert(
			staleSaveRejected?.join(",") === "title",
			`A same-field stale draft update was not refused: ${JSON.stringify(staleSaveRejected)}`,
		);

		const firstPublication = await publishNativeItemDraft(
			db,
			draft.itemKey,
		);
		assert(
			firstPublication.revision === 1 &&
				firstPublication.title === "First published title",
			"First publication has the wrong revision or content",
		);
		const [publishedProjection] = await db
			.select()
			.from(adminItemListProjection)
			.where(eq(adminItemListProjection.key, draft.itemKey));
		assert(
			publishedProjection?.state === "published" &&
				publishedProjection.revision === 1,
			"Publication did not synchronously refresh projected state",
		);

		const [remainingDraft] = await db
			.select()
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, draft.itemKey));
		assert(!remainingDraft, "Published draft was not removed");

		const publishedTags = await db
			.select()
			.from(itemToTag)
			.where(eq(itemToTag.itemKey, draft.itemKey));
		assert(
			publishedTags.length === 1 &&
				publishedTags[0]!.tagName === publishedTag,
			"Published tags were not normalized",
		);
		await db.insert(publicationTarget).values([
			{
				itemKey: draft.itemKey,
				provider: "crossref",
				environment: "test",
				requestedBy: "native-lifecycle-test",
			},
			{
				itemKey: draft.itemKey,
				provider: "zenodo",
				environment: "sandbox",
				identifierPolicy: "mint-zenodo",
				requestedBy: "native-lifecycle-test",
			},
		]);

		const patchMergeDraft = await createNativeItemDraft(db, {
			abstractNote: "Published abstract",
			date: "2024",
			itemType: "Report",
			title: "Published merge title",
		});
		createdKeys.push(patchMergeDraft.itemKey);
		await publishNativeItemDraft(db, patchMergeDraft.itemKey);
		await db.insert(publicationTarget).values({
			itemKey: patchMergeDraft.itemKey,
			provider: "crossref",
			environment: "test",
			requestedBy: "native-lifecycle-test",
			deactivatedAt: new Date(),
		});
		const patchMergeEdit = await openNativeItemDraft(
			db,
			patchMergeDraft.itemKey,
		);
		const { abstractNote: _removedAbstract, ...patchMergePayload } =
			patchMergeEdit.payload;
		await db
			.update(item)
			.set({
				date: "2026",
				revision: sql`${item.revision} + 1`,
				updatedAt: new Date(),
			})
			.where(eq(item.key, patchMergeDraft.itemKey));
		await saveNativeItemDraft(db, {
			expectedDraftRevision: patchMergeEdit.draftRevision,
			expectedPayload: patchMergeEdit.payload,
			itemKey: patchMergeDraft.itemKey,
			payload: {
				...patchMergePayload,
				title: "Locally edited merge title",
			},
		});
		const [storedPatch] = await db
			.select({ patch: itemDraft.patch })
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, patchMergeDraft.itemKey));
		assert(
			storedPatch?.patch.title === "Locally edited merge title" &&
				storedPatch.patch.abstractNote === null &&
				Object.keys(storedPatch.patch).length === 2,
			"Saved draft did not contain only changed fields and tombstones",
		);
		const mergedPublication = await publishNativeItemDraft(
			db,
			patchMergeDraft.itemKey,
		);
		assert(
			mergedPublication.title === "Locally edited merge title" &&
				mergedPublication.abstractNote === null &&
				mergedPublication.date === "2026",
			"Publishing did not apply the patch to the latest canonical base",
		);
		const inactiveTargetJobs = await db
			.select({ id: publicationSyncJob.id })
			.from(publicationSyncJob)
			.where(eq(publicationSyncJob.itemKey, patchMergeDraft.itemKey));
		assert(
			inactiveTargetJobs.length === 0,
			"A deactivated publication target received a record-change job",
		);

		await db.insert(sourceConnection).values({
			externalScopeKey: `verify-native-memberships-${Date.now()}`,
			key: importedSourceKey,
			provider: "zotero",
			scopeKind: "group",
		});
		importedSourceCreated = true;
		const importedSourceRecordKeys = [
			"verify-imported-membership-a",
			"verify-imported-membership-b",
		];
		const importedIdentities = await reserveCollectionIdentities(db, {
			sourceConnectionKey: importedSourceKey,
			sourceRecordKeys: importedSourceRecordKeys,
		});
		importedCollectionKeys = importedSourceRecordKeys.map(
			(sourceRecordKey) => importedIdentities.get(sourceRecordKey)!,
		);
		await db.insert(collection).values(
			importedSourceRecordKeys.map((sourceRecordKey, index) => ({
				key: importedCollectionKeys[index]!,
				name: `Imported verification collection ${index + 1}`,
				sourceConnectionKey: importedSourceKey,
				sourceRecordKey,
			})),
		);
		await db.insert(itemToCollection).values({
			collectionKey: importedCollectionKeys[0]!,
			itemKey: draft.itemKey,
		});

		const reopenedDrafts = await Promise.all(
			Array.from({ length: 8 }, () =>
				openNativeItemDraft(db, draft.itemKey),
			),
		);
		const reopened = reopenedDrafts[0]!;
		assert(
			reopenedDrafts.every(
				(candidate) =>
					candidate.itemKey === reopened.itemKey &&
					candidate.draftRevision === reopened.draftRevision,
			) &&
				reopened.baseRevision === 1 &&
				reopened.payload.title === "First published title" &&
				Array.isArray(reopened.payload.collections) &&
				reopened.payload.collections[0] === importedCollectionKeys[0],
			"Concurrent opens did not converge on one isolated draft",
		);
		for (const collections of [
			[],
			[importedCollectionKeys[0]!, importedCollectionKeys[1]!],
		]) {
			let importedMutationRejected = false;
			try {
				await saveNativeItemDraft(db, {
					itemKey: draft.itemKey,
					expectedDraftRevision: reopened.draftRevision,
					expectedPayload: reopened.payload,
					payload: {
						collections,
						itemType: "Book",
						title: "Invalid imported membership mutation",
					},
				});
			} catch (error) {
				importedMutationRejected =
					error instanceof NativeItemValidationError;
			}
			assert(
				importedMutationRejected,
				"Imported collection membership mutation was accepted",
			);
		}
		await saveNativeItemDraft(db, {
			itemKey: draft.itemKey,
			expectedDraftRevision: reopened.draftRevision,
			expectedPayload: reopened.payload,
			payload: {
				collections: [importedCollectionKeys[0]!],
				itemType: "Book",
				title: "Second published title",
				tags: [secondTag],
			},
		});
		const secondPublication = await publishNativeItemDraft(
			db,
			draft.itemKey,
		);
		assert(
			secondPublication.revision === 2 &&
				secondPublication.title === "Second published title",
			"Second publication was not revisioned",
		);
		const publicationJobsAfterEdit = await db
			.select()
			.from(publicationSyncJob)
			.where(eq(publicationSyncJob.itemKey, draft.itemKey));
		assert(
			publicationJobsAfterEdit.length === 1 &&
				publicationJobsAfterEdit[0]?.provider === "crossref" &&
				publicationJobsAfterEdit[0].reason === "record_changed" &&
				publicationJobsAfterEdit[0].canonicalRevision === 2,
			"Record publication did not queue only the ready active target",
		);
		const retainedMemberships = await db
			.select({ key: itemToCollection.collectionKey })
			.from(itemToCollection)
			.where(eq(itemToCollection.itemKey, draft.itemKey));
		assert(
			retainedMemberships.length === 1 &&
				retainedMemberships[0]!.key === importedCollectionKeys[0],
			"Publication changed an imported collection membership",
		);

		const restoreDraft = await openNativeItemDraft(db, draft.itemKey);
		await saveNativeItemDraft(db, {
			itemKey: draft.itemKey,
			expectedDraftRevision: restoreDraft.draftRevision,
			expectedPayload: restoreDraft.payload,
			payload: {
				...restoreDraft.payload,
				title: "Restored published title",
			},
		});
		let activePublicationBlocked = false;
		try {
			await unpublishNativeItem(db, draft.itemKey);
		} catch (error) {
			activePublicationBlocked =
				error instanceof ItemHasActivePublicationError;
		}
		assert(
			activePublicationBlocked,
			"An active DOI publication did not block record unpublishing",
		);
		const [stillPublished] = await db
			.select({ deleted: item.deleted, revision: item.revision })
			.from(item)
			.where(eq(item.key, draft.itemKey));
		assert(
			stillPublished?.deleted === 0 && stillPublished.revision === 2,
			"The blocked unpublish changed the canonical record",
		);
		await db
			.update(publicationTarget)
			.set({ deactivatedAt: new Date() })
			.where(eq(publicationTarget.itemKey, draft.itemKey));
		const unpublishedWithDraft = await unpublishNativeItem(
			db,
			draft.itemKey,
		);
		const [advancedRestoreDraft] = await db
			.select()
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, draft.itemKey));
		assert(
			unpublishedWithDraft.revision === 3 &&
				advancedRestoreDraft?.baseRevision === 3,
			"Unpublish made the record's open draft stale",
		);
		const publicationJobsAfterUnpublish = await db
			.select({ id: publicationSyncJob.id })
			.from(publicationSyncJob)
			.where(eq(publicationSyncJob.itemKey, draft.itemKey));
		assert(
			publicationJobsAfterUnpublish.length === 1,
			"Record unpublication queued an unsupported DOI withdrawal",
		);
		const restored = await publishNativeItemDraft(db, draft.itemKey);
		assert(
			restored.revision === 4 &&
				restored.deleted === 0 &&
				restored.title === "Restored published title",
			"Open draft could not restore an unpublished record",
		);

		const unpublished = await unpublishNativeItem(db, draft.itemKey);
		assert(
			unpublished.deleted === 1 &&
				unpublished.deletedAt !== null &&
				unpublished.revision === 5,
			"Unpublish did not create a tombstone revision",
		);
		const publicationJobsAfterSecondUnpublish = await db
			.select()
			.from(publicationSyncJob)
			.where(eq(publicationSyncJob.itemKey, draft.itemKey));
		assert(
			publicationJobsAfterSecondUnpublish.length === 1,
			"A deactivated DOI target or record unpublish queued extra publication work",
		);
		const [deletedProjection] = await db
			.select()
			.from(adminItemListProjection)
			.where(eq(adminItemListProjection.key, draft.itemKey));
		assert(
			deletedProjection?.state === "deleted" &&
				deletedProjection.revision === 5,
			"Unpublish did not synchronously refresh projected state",
		);
		const repeatedUnpublish = await unpublishNativeItem(db, draft.itemKey);
		assert(
			repeatedUnpublish.revision === unpublished.revision,
			"Repeated unpublish created a redundant revision",
		);

		const childParentDraft = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Parent with native note",
		});
		const noteDraft = await createNativeItemDraft(db, {
			itemType: "Note",
			note: "Native child note",
			parentItem: childParentDraft.itemKey,
		});
		createdKeys.push(childParentDraft.itemKey, noteDraft.itemKey);
		await publishNativeItemDraft(db, childParentDraft.itemKey);
		await publishNativeItemDraft(db, noteDraft.itemKey);
		const childParentEdit = await openNativeItemDraft(
			db,
			childParentDraft.itemKey,
		);
		const unpublishedNote = await unpublishNativeItem(
			db,
			noteDraft.itemKey,
		);
		const [advancedChildParentDraft] = await db
			.select()
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, childParentDraft.itemKey));
		assert(
			unpublishedNote.revision === 2 &&
				childParentEdit.baseRevision === 2 &&
				advancedChildParentDraft?.baseRevision === 3,
			"Non-attachment child changes did not advance the parent draft",
		);
		const republishedChildParent = await publishNativeItemDraft(
			db,
			childParentDraft.itemKey,
		);
		assert(
			republishedChildParent.revision === 4,
			"Parent draft could not publish after native note changes",
		);

		const oldParentDraft = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Old native parent",
		});
		const newParentDraft = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "New native parent",
		});
		const reparentedNoteDraft = await createNativeItemDraft(db, {
			itemType: "Note",
			note: "Reparented native note",
			parentItem: oldParentDraft.itemKey,
		});
		createdKeys.push(
			oldParentDraft.itemKey,
			newParentDraft.itemKey,
			reparentedNoteDraft.itemKey,
		);
		await publishNativeItemDraft(db, oldParentDraft.itemKey);
		await publishNativeItemDraft(db, newParentDraft.itemKey);
		await publishNativeItemDraft(db, reparentedNoteDraft.itemKey);
		const reparentDraft = await openNativeItemDraft(
			db,
			reparentedNoteDraft.itemKey,
		);
		await saveNativeItemDraft(db, {
			itemKey: reparentedNoteDraft.itemKey,
			expectedDraftRevision: reparentDraft.draftRevision,
			expectedPayload: reparentDraft.payload,
			payload: {
				...reparentDraft.payload,
				parentItem: newParentDraft.itemKey,
			},
		});
		const reparented = await publishNativeItemDraftWithContext(
			db,
			reparentedNoteDraft.itemKey,
		);
		assert(
			reparented.previousParentItem === oldParentDraft.itemKey &&
				reparented.item.parentItem === newParentDraft.itemKey,
			"Reparent publication did not expose both cache invalidation keys",
		);
		const parentWithChildDraft = await openNativeItemDraft(
			db,
			newParentDraft.itemKey,
		);
		let nestedParentRejected = false;
		try {
			await saveNativeItemDraft(db, {
				itemKey: newParentDraft.itemKey,
				expectedDraftRevision: parentWithChildDraft.draftRevision,
				expectedPayload: parentWithChildDraft.payload,
				payload: {
					...parentWithChildDraft.payload,
					parentItem: oldParentDraft.itemKey,
				},
			});
		} catch (error) {
			nestedParentRejected = error instanceof NativeItemValidationError;
		}
		assert(
			nestedParentRejected,
			"A top-level item accepted an invalid parent assignment",
		);

		const concurrentMutationRunCount = 3;
		for (let run = 0; run < concurrentMutationRunCount; run += 1) {
			const concurrentMutationDraft = await createNativeItemDraft(db, {
				itemType: "Report",
				title: `Concurrent publish and unpublish ${run + 1}`,
			});
			createdKeys.push(concurrentMutationDraft.itemKey);
			await publishNativeItemDraft(db, concurrentMutationDraft.itemKey);
			await openNativeItemDraft(db, concurrentMutationDraft.itemKey);
			const concurrentMutationResults = await Promise.allSettled([
				publishNativeItemDraft(db, concurrentMutationDraft.itemKey),
				unpublishNativeItem(db, concurrentMutationDraft.itemKey),
			]);
			assert(
				concurrentMutationResults.every(
					(result) => result.status === "fulfilled",
				),
				"Concurrent publish and unpublish deadlocked or failed",
			);
			const [concurrentlyMutated] = await db
				.select({ revision: item.revision })
				.from(item)
				.where(eq(item.key, concurrentMutationDraft.itemKey));
			assert(
				concurrentlyMutated?.revision === 3,
				"Concurrent mutations did not serialize into two revisions",
			);
		}

		const concurrencyCollection = await createNativeCollection(db, {
			name: "Concurrent assignment verification",
			parentCollection: null,
		});
		nativeCollectionKey = concurrencyCollection.key;
		const assignDiscardDraft = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Concurrent assign and discard",
		});
		createdKeys.push(assignDiscardDraft.itemKey);
		await publishNativeItemDraft(db, assignDiscardDraft.itemKey);
		await openNativeItemDraft(db, assignDiscardDraft.itemKey);
		const assignmentAndDiscard = await runBehindNativeItemBarrier(
			db,
			observer,
			assignDiscardDraft.itemKey,
			() => [
				assignNativeItemDraftToCollection(
					db,
					assignDiscardDraft.itemKey,
					concurrencyCollection.key,
				),
				discardNativeItemDraft(db, assignDiscardDraft.itemKey),
			],
		);
		assert(
			assignmentAndDiscard.every(({ status }) => status === "fulfilled"),
			"Concurrent assignment and discard deadlocked or failed",
		);
		const [settledDraft] = await db
			.select({ patch: itemDraft.patch })
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, assignDiscardDraft.itemKey))
			.limit(1);
		assert(
			!settledDraft ||
				(Array.isArray(settledDraft.patch.collections) &&
					settledDraft.patch.collections.includes(
						concurrencyCollection.key,
					)),
			"Concurrent assignment and discard left an unassigned draft",
		);

		const publishRemoveDraft = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Concurrent publish and remove",
		});
		createdKeys.push(publishRemoveDraft.itemKey);
		const publishAndRemove = await runBehindNativeItemBarrier(
			db,
			observer,
			publishRemoveDraft.itemKey,
			() => [
				publishNativeItemDraft(db, publishRemoveDraft.itemKey),
				removeNativeItem(db, publishRemoveDraft.itemKey),
			],
		);
		assert(
			publishAndRemove[1]?.status === "fulfilled",
			"Concurrent draft-only removal failed",
		);
		const [[publishRemoveItem], [publishRemoveOpenDraft]] =
			await Promise.all([
				db
					.select({ deleted: item.deleted })
					.from(item)
					.where(eq(item.key, publishRemoveDraft.itemKey))
					.limit(1),
				db
					.select({ itemKey: itemDraft.itemKey })
					.from(itemDraft)
					.where(eq(itemDraft.itemKey, publishRemoveDraft.itemKey))
					.limit(1),
			]);
		assert(
			(!publishRemoveItem || publishRemoveItem.deleted === 1) &&
				!publishRemoveOpenDraft,
			"Concurrent publish and remove left a live item or draft",
		);

		let invalidCollectionRejected = false;
		try {
			await createNativeItemDraft(db, {
				itemType: "Report",
				title: "Must be rejected",
				collections: ["ZZZZZZZZ"],
			});
		} catch {
			invalidCollectionRejected = true;
		}
		assert(
			invalidCollectionRejected,
			"Draft creation accepted a missing collection",
		);

		const concurrentDrafts = await Promise.all(
			Array.from({ length: 24 }, (_, index) =>
				createNativeItemDraft(db, {
					itemType: "Document",
					title: `Concurrent draft ${index}`,
				}),
			),
		);
		createdKeys.push(...concurrentDrafts.map(({ itemKey }) => itemKey));
		assert(
			new Set(concurrentDrafts.map(({ itemKey }) => itemKey)).size ===
				concurrentDrafts.length,
			"Concurrent draft allocation produced duplicate keys",
		);
		await Promise.all(
			concurrentDrafts.map(({ itemKey }) =>
				discardNativeItemDraft(db, itemKey),
			),
		);

		const events = await db
			.select()
			.from(outbox)
			.where(eq(outbox.entityKey, draft.itemKey))
			.orderBy(outbox.id);
		assert(
			events
				.map(({ operation, revision }) => `${operation}:${revision}`)
				.join(",") === "upsert:1,upsert:2,delete:3,upsert:4,delete:5",
			"Published lifecycle emitted the wrong outbox sequence",
		);

		console.log(
			JSON.stringify({
				itemKey: draft.itemKey,
				publishedRevisions: 3,
				outboxEvents: events.length,
				concurrentReservations: concurrentDrafts.length,
				concurrentMutationRuns: concurrentMutationRunCount,
				concurrentAssignDiscardVerified: true,
				concurrentPublishRemoveVerified: true,
				fieldPatchMergeVerified: true,
			}),
		);
	} finally {
		if (createdKeys.length > 0) {
			await db.transaction(async (transaction) => {
				await transaction
					.delete(publicationSyncJob)
					.where(inArray(publicationSyncJob.itemKey, createdKeys));
				await transaction
					.delete(publicationTarget)
					.where(inArray(publicationTarget.itemKey, createdKeys));
				await transaction
					.delete(outbox)
					.where(
						and(
							eq(outbox.entityType, "item"),
							inArray(outbox.entityKey, createdKeys),
						),
					);
				await transaction
					.delete(itemToCollection)
					.where(inArray(itemToCollection.itemKey, createdKeys));
				await transaction
					.delete(itemToTag)
					.where(inArray(itemToTag.itemKey, createdKeys));
				await transaction
					.delete(itemFilePublication)
					.where(inArray(itemFilePublication.itemKey, createdKeys));
				await transaction
					.delete(itemFileDraft)
					.where(inArray(itemFileDraft.itemKey, createdKeys));
				await transaction
					.delete(adminItemListProjection)
					.where(inArray(adminItemListProjection.key, createdKeys));
				await transaction
					.delete(item)
					.where(inArray(item.key, createdKeys));
				await transaction
					.delete(itemDraft)
					.where(inArray(itemDraft.itemKey, createdKeys));
				await transaction
					.delete(itemIdentity)
					.where(
						and(
							eq(itemIdentity.sourceConnectionKey, "native"),
							inArray(itemIdentity.key, createdKeys),
						),
					);
				await transaction
					.delete(tag)
					.where(inArray(tag.name, verificationTags));
			});

			const residueCounts = await Promise.all([
				db
					.select({ count: count() })
					.from(itemIdentity)
					.where(inArray(itemIdentity.key, createdKeys)),
				db
					.select({ count: count() })
					.from(item)
					.where(inArray(item.key, createdKeys)),
				db
					.select({ count: count() })
					.from(itemDraft)
					.where(inArray(itemDraft.itemKey, createdKeys)),
				db
					.select({ count: count() })
					.from(itemFileDraft)
					.where(inArray(itemFileDraft.itemKey, createdKeys)),
				db
					.select({ count: count() })
					.from(itemFilePublication)
					.where(inArray(itemFilePublication.itemKey, createdKeys)),
				db
					.select({ count: count() })
					.from(adminItemListProjection)
					.where(inArray(adminItemListProjection.key, createdKeys)),
				db
					.select({ count: count() })
					.from(itemToCollection)
					.where(inArray(itemToCollection.itemKey, createdKeys)),
				db
					.select({ count: count() })
					.from(itemToTag)
					.where(inArray(itemToTag.itemKey, createdKeys)),
				db
					.select({ count: count() })
					.from(outbox)
					.where(
						and(
							eq(outbox.entityType, "item"),
							inArray(outbox.entityKey, createdKeys),
						),
					),
				db
					.select({ count: count() })
					.from(tag)
					.where(inArray(tag.name, verificationTags)),
			]);
			assert(
				residueCounts.every(([result]) => result?.count === 0),
				`Native lifecycle cleanup left residue: ${JSON.stringify(residueCounts)}`,
			);
		}
		if (importedSourceCreated) {
			await db
				.delete(collection)
				.where(eq(collection.sourceConnectionKey, importedSourceKey));
			await db
				.delete(collectionIdentity)
				.where(
					eq(
						collectionIdentity.sourceConnectionKey,
						importedSourceKey,
					),
				);
			await db
				.delete(sourceConnection)
				.where(eq(sourceConnection.key, importedSourceKey));
		}
		if (nativeCollectionKey) {
			await db
				.delete(outbox)
				.where(
					and(
						eq(outbox.entityType, "collection"),
						eq(outbox.entityKey, nativeCollectionKey),
					),
				);
			await db
				.delete(collection)
				.where(eq(collection.key, nativeCollectionKey));
			await db
				.delete(collectionIdentity)
				.where(eq(collectionIdentity.key, nativeCollectionKey));
		}
		await Promise.all([resource.dispose(), observerResource.dispose()]);
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
