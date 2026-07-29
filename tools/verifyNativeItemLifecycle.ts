import { itemDraft, itemIdentity, outbox } from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { item } from "../src/db/schema/tables/item";
import { itemToTag } from "../src/db/schema/tables/itemToTag";
import {
	createNativeItemDraft,
	discardNativeItemDraft,
	NativeDraftConflictError,
	openNativeItemDraft,
	publishNativeItemDraft,
	saveNativeItemDraft,
	unpublishNativeItem,
} from "../src/lib/admin/native-item-service";

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

	try {
		const draft = await createNativeItemDraft(db, {
			itemType: "book",
			title: "Draft-only title",
			creators: [{ creatorType: "author", name: "Example Author" }],
			tags: ["draft-tag"],
		});
		createdKeys.push(draft.itemKey);

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
				creators: [
					{ creatorType: "author", name: "Example Author" },
				],
				tags: ["published-tag"],
			},
		});
		assert(saved.draftRevision === 2, "Draft revision did not advance");

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
				reopened.payload.title === "First published title",
			"Concurrent opens did not converge on one isolated draft",
		);
		await saveNativeItemDraft(db, {
			itemKey: draft.itemKey,
			expectedDraftRevision: reopened.draftRevision,
			payload: {
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

		const unpublished = await unpublishNativeItem(db, draft.itemKey);
		assert(
			unpublished.deleted === 1 &&
				unpublished.deletedAt !== null &&
				unpublished.revision === 3,
			"Unpublish did not create a tombstone revision",
		);
		const repeatedUnpublish = await unpublishNativeItem(
			db,
			draft.itemKey,
		);
		assert(
			repeatedUnpublish.revision === unpublished.revision,
			"Repeated unpublish created a redundant revision",
		);

		const brokenDraft = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Must roll back",
			collections: ["ZZZZZZZZ"],
		});
		createdKeys.push(brokenDraft.itemKey);
		let invalidCollectionRejected = false;
		try {
			await publishNativeItemDraft(db, brokenDraft.itemKey);
		} catch {
			invalidCollectionRejected = true;
		}
		assert(
			invalidCollectionRejected,
			"Publication accepted a missing collection",
		);
		const [rolledBackDraft] = await db
			.select()
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, brokenDraft.itemKey));
		const [rolledBackItem] = await db
			.select()
			.from(item)
			.where(eq(item.key, brokenDraft.itemKey));
		assert(
			rolledBackDraft && !rolledBackItem,
			"Failed publication was not atomic",
		);
		await discardNativeItemDraft(db, brokenDraft.itemKey);

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
			events.map(({ operation, revision }) => `${operation}:${revision}`)
				.join(",") === "upsert:1,upsert:2,delete:3",
			"Published lifecycle emitted the wrong outbox sequence",
		);

		console.log(
			JSON.stringify({
				itemKey: draft.itemKey,
				publishedRevisions: 2,
				outboxEvents: events.length,
				concurrentReservations: concurrentDrafts.length,
			}),
		);
	} finally {
		if (createdKeys.length > 0) {
			await db
				.delete(outbox)
				.where(inArray(outbox.entityKey, createdKeys));
			await db.delete(item).where(inArray(item.key, createdKeys));
			await db
				.delete(itemDraft)
				.where(inArray(itemDraft.itemKey, createdKeys));
			await db
				.delete(itemIdentity)
				.where(
					and(
						eq(
							itemIdentity.sourceConnectionKey,
							"native",
						),
						inArray(itemIdentity.key, createdKeys),
					),
				);
		}
		await resource.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
