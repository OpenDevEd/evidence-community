import {
	collectionIdentity,
	itemDraft,
	itemIdentity,
	outbox,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { reserveCollectionIdentities } from "../src/db/record-identity";
import { collection } from "../src/db/schema/tables/collection";
import { adminItemListProjection } from "../src/db/schema/tables/adminItemListProjection";
import { item } from "../src/db/schema/tables/item";
import { itemToCollection } from "../src/db/schema/tables/itemToCollection";
import { itemToTag } from "../src/db/schema/tables/itemToTag";
import {
	createNativeItemDraft,
	discardNativeItemDraft,
	NativeDraftConflictError,
	NativeItemHasChildrenError,
	openNativeItemDraft,
	publishNativeItemDraft,
	publishNativeItemDraftWithContext,
	saveNativeItemDraft,
	unpublishNativeItem,
} from "../src/lib/admin/native-item-service";
import { NativeItemValidationError } from "../src/lib/admin/native-item-validation";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) {
	throw new Error("DATABASE_URL_POST is required");
}
const verifiedDatabaseUrl = databaseUrl;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function verify() {
	const resource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const db = resource.database;
	const createdKeys: string[] = [];
	const importedSourceKey = `verify-zotero-${process.pid}`;
	let importedSourceCreated = false;
	let importedCollectionKeys: string[] = [];

	try {
		const draft = await createNativeItemDraft(db, {
			itemType: "book",
			title: "Draft-only title",
			creators: [{ creatorType: "author", name: "Example Author" }],
			tags: ["draft-tag"],
		});
		createdKeys.push(draft.itemKey);
		const [draftProjection] = await db
			.select()
			.from(adminItemListProjection)
			.where(eq(adminItemListProjection.key, draft.itemKey));
		assert(
			draftProjection?.state === "draft" &&
				draftProjection.title === "Draft-only title" &&
				draftProjection.tags.includes("draft-tag"),
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
			payload: {
				itemType: "Book",
				title: "First published title",
				creators: [{ creatorType: "author", name: "Example Author" }],
				tags: ["published-tag"],
			},
		});
		assert(saved.draftRevision === 2, "Draft revision did not advance");
		const [savedProjection] = await db
			.select()
			.from(adminItemListProjection)
			.where(eq(adminItemListProjection.key, draft.itemKey));
		assert(
			savedProjection?.title === "First published title" &&
				savedProjection.tags.includes("published-tag"),
			"Draft save did not synchronously refresh projected metadata",
		);

		let staleSaveRejected = false;
		try {
			await saveNativeItemDraft(db, {
				itemKey: draft.itemKey,
				expectedDraftRevision: 1,
				payload: { itemType: "Book", title: "Stale edit" },
			});
		} catch (error) {
			staleSaveRejected = error instanceof NativeDraftConflictError;
		}
		assert(staleSaveRejected, "A stale draft update was accepted");

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
				publishedTags[0]!.tagName === "published-tag",
			"Published tags were not normalized",
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
			payload: {
				collections: [importedCollectionKeys[0]!],
				itemType: "Book",
				title: "Second published title",
				tags: ["second-tag"],
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
			payload: {
				...restoreDraft.payload,
				title: "Restored published title",
			},
		});
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
		await saveNativeItemDraft(db, {
			itemKey: newParentDraft.itemKey,
			expectedDraftRevision: parentWithChildDraft.draftRevision,
			payload: {
				...parentWithChildDraft.payload,
				parentItem: oldParentDraft.itemKey,
			},
		});
		let nestedParentRejected = false;
		try {
			await publishNativeItemDraft(db, newParentDraft.itemKey);
		} catch (error) {
			nestedParentRejected = error instanceof NativeItemHasChildrenError;
		}
		assert(
			nestedParentRejected,
			"Reparenting an item with live children was accepted",
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
			}),
		);
	} finally {
		if (createdKeys.length > 0) {
			await db
				.delete(outbox)
				.where(
					and(
						eq(outbox.entityType, "item"),
						inArray(outbox.entityKey, createdKeys),
					),
				);
			await db.delete(item).where(inArray(item.key, createdKeys));
			await db
				.delete(itemDraft)
				.where(inArray(itemDraft.itemKey, createdKeys));
			await db
				.delete(itemIdentity)
				.where(
					and(
						eq(itemIdentity.sourceConnectionKey, "native"),
						inArray(itemIdentity.key, createdKeys),
					),
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
		await resource.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
