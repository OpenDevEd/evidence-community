import {
	collectionIdentity,
	itemIdentity,
	itemSourceLink,
	outbox,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { collection } from "../src/db/schema/tables/collection";
import { item } from "../src/db/schema/tables/item";
import { itemToCollection } from "../src/db/schema/tables/itemToCollection";
import { itemToTag } from "../src/db/schema/tables/itemToTag";
import { createNativeCollection } from "../src/lib/admin/native-collection-service";
import {
	createNativeItemDraft,
	discardItemDraft,
	getItemDraft,
	ItemHasChildrenError,
	ItemWritebackUnavailableError,
	openItemDraft,
	publishItemDraft,
	removeNativeItem,
	saveItemDraft,
	type ItemWritebackPolicyOptions,
} from "../src/lib/admin/native-item-service";
import { writeSourceIngestionBatch } from "../src/lib/source-ingestion/transactional-writer";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;
const baseUrl = process.env.EVIDENCE_LIBRARY_TEST_URL;

const connectionKey = "zotero-linked-draft-test";
const secondaryConnectionKey = "mendeley-linked-draft-test";
const writebackPolicyOptions = {
	writebackConfig: {
		sources: [{ key: connectionKey, writebackEnabled: true }],
	},
} satisfies ItemWritebackPolicyOptions;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function adminRequest<T>(
	path: string,
	init: RequestInit = {},
	expectedStatus = 200,
) {
	assert(baseUrl, "EVIDENCE_LIBRARY_TEST_URL is required for HTTP checks");
	const response = await fetch(`${baseUrl}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...init.headers,
		},
	});
	const body = await response.json().catch(() => null);
	assert(
		response.status === expectedStatus,
		`${init.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`,
	);
	assert(
		response.headers.get("cache-control")?.includes("private") &&
			response.headers.get("cache-control")?.includes("no-store"),
		`${path} did not return private no-store headers`,
	);
	return body as T;
}

function batch(
	expectedVersion: number | null,
	nextVersion: number,
	sourceConnectionKey = connectionKey,
) {
	return {
		sourceConnectionKey,
		expectedCursor:
			expectedVersion === null ? {} : { version: expectedVersion },
		nextCursor: { version: nextVersion },
		mappingProfileVersion: "zotero-v1",
		fetchedAt: new Date(),
		collections: [],
		items: [],
	};
}

async function verify() {
	const resource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const db = resource.database;
	let nativeCollectionKey: string | null = null;
	let nativeParentKey: string | null = null;

	try {
		await db.insert(sourceConnection).values([
			{
				key: connectionKey,
				provider: "zotero",
				scopeKind: "group",
				externalScopeKey: "linked-draft-test",
			},
			{
				key: secondaryConnectionKey,
				provider: "mendeley",
				scopeKind: "group",
				externalScopeKey: "linked-draft-secondary-test",
			},
		]);

		const imported = await writeSourceIngestionBatch(db, {
			...batch(null, 1),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "EDIT2345",
					remoteVersion: "1",
					raw: { key: "EDIT2345", version: 1 },
					metadata: {
						abstractNote: "Initial remote abstract",
						itemType: "Report",
						tags: ["remote"],
						title: "Initial remote title",
					},
				},
			],
		});
		const itemKey = imported.itemKeys.EDIT2345!;
		await db.insert(itemSourceLink).values({
			itemKey,
			sourceConnectionKey: secondaryConnectionKey,
			sourceRecordKey: "SECOND45",
		});
		await db
			.update(itemSourceLink)
			.set({ writebackEnabled: false })
			.where(
				and(
					eq(itemSourceLink.itemKey, itemKey),
					eq(itemSourceLink.sourceConnectionKey, connectionKey),
				),
			);

		let readOnlyRejected = false;
		try {
			await openItemDraft(db, itemKey, writebackPolicyOptions);
		} catch (error) {
			readOnlyRejected = error instanceof ItemWritebackUnavailableError;
		}
		assert(
			readOnlyRejected,
			"An imported item without enabled writeback was editable",
		);
		if (baseUrl) {
			const rejectedResponse = await adminRequest<{
				error: { code: string; message: string };
			}>(`/api/admin/items/${itemKey}/draft`, { method: "POST" }, 409);
			assert(
				rejectedResponse.error.code === "conflict" &&
					rejectedResponse.error.message.includes("writeback"),
				"The admin API did not explain why the imported item is read only",
			);
		}

		await db
			.update(itemSourceLink)
			.set({ writebackEnabled: true })
			.where(
				and(
					eq(itemSourceLink.itemKey, itemKey),
					eq(itemSourceLink.sourceConnectionKey, connectionKey),
				),
			);
		const nativeCollection = await createNativeCollection(db, {
			name: "Local curation",
			parentCollection: null,
		});
		nativeCollectionKey = nativeCollection.key;

		const opened = await openItemDraft(db, itemKey, writebackPolicyOptions);
		await saveItemDraft(
			db,
			{
				expectedDraftRevision: opened.draftRevision,
				expectedPayload: opened.payload,
				itemKey,
				payload: {
					...opened.payload,
					collections: [nativeCollection.key],
					language: "fr",
					tags: ["local"],
					title: "Local title",
				},
			},
			writebackPolicyOptions,
		);

		await writeSourceIngestionBatch(db, {
			...batch(1, 2),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "EDIT2345",
					remoteVersion: "2",
					raw: { key: "EDIT2345", version: 2 },
					metadata: {
						abstractNote: "Remote abstract while editing",
						itemType: "Report",
						tags: ["remote-two"],
						title: "Remote title while editing",
					},
				},
			],
		});
		const rebasedDraft = await getItemDraft(db, itemKey);
		assert(
			rebasedDraft.payload.title === "Local title" &&
				rebasedDraft.payload.abstractNote ===
					"Remote abstract while editing",
			"An imported draft did not overlay its patch on the latest remote base",
		);

		const published = await publishItemDraft(
			db,
			itemKey,
			writebackPolicyOptions,
		);
		const [[publishedLink], publishedMemberships, publishedTags] =
			await Promise.all([
				db
					.select()
					.from(itemSourceLink)
					.where(
						and(
							eq(itemSourceLink.itemKey, itemKey),
							eq(
								itemSourceLink.sourceConnectionKey,
								connectionKey,
							),
						),
					),
				db
					.select()
					.from(itemToCollection)
					.where(eq(itemToCollection.itemKey, itemKey)),
				db
					.select()
					.from(itemToTag)
					.where(eq(itemToTag.itemKey, itemKey)),
			]);
		assert(
			published.title === "Local title" &&
				published.abstractNote === "Remote abstract while editing" &&
				publishedMemberships.some(
					(row) => row.collectionKey === nativeCollection.key,
				) &&
				publishedTags.some((row) => row.tagName === "local") &&
				JSON.stringify(publishedLink?.dirtyFields) ===
					JSON.stringify(["language", "tags", "title"]),
			"Publishing an imported draft did not preserve source identity, local curation, or dirty fields",
		);

		const secondEdit = await openItemDraft(
			db,
			itemKey,
			writebackPolicyOptions,
		);
		await saveItemDraft(
			db,
			{
				expectedDraftRevision: secondEdit.draftRevision,
				expectedPayload: secondEdit.payload,
				itemKey,
				payload: {
					...secondEdit.payload,
					title: "Local title for every source",
				},
			},
			writebackPolicyOptions,
		);
		await publishItemDraft(db, itemKey, writebackPolicyOptions);
		const linkedSources = await db
			.select()
			.from(itemSourceLink)
			.where(eq(itemSourceLink.itemKey, itemKey));
		assert(
			linkedSources.length === 2 &&
				linkedSources.every((link) =>
					link.dirtyFields.includes("title"),
				),
			"Publishing did not protect local edits against every linked source",
		);
		await writeSourceIngestionBatch(db, {
			...batch(null, 1, secondaryConnectionKey),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "SECOND45",
					remoteVersion: "1",
					raw: { key: "SECOND45", version: 1 },
					metadata: {
						itemType: "Report",
						title: "Secondary remote title",
					},
				},
			],
		});
		const [afterSecondaryInbound] = await db
			.select({ title: item.title })
			.from(item)
			.where(eq(item.key, itemKey));
		assert(
			afterSecondaryInbound?.title === "Local title for every source",
			"A secondary linked source overwrote a locally published edit",
		);

		await writeSourceIngestionBatch(db, {
			...batch(2, 3),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "EDIT2345",
					remoteVersion: "3",
					raw: { key: "EDIT2345", version: 3 },
					metadata: {
						abstractNote: "Latest remote abstract",
						itemType: "Report",
						language: "de",
						tags: ["remote-three"],
						title: "Latest remote title",
					},
				},
			],
		});
		const [[afterInbound], membershipsAfterInbound, tagsAfterInbound] =
			await Promise.all([
				db.select().from(item).where(eq(item.key, itemKey)),
				db
					.select()
					.from(itemToCollection)
					.where(eq(itemToCollection.itemKey, itemKey)),
				db
					.select()
					.from(itemToTag)
					.where(eq(itemToTag.itemKey, itemKey)),
			]);
		assert(
			afterInbound?.title === "Local title for every source" &&
				afterInbound.abstractNote === "Latest remote abstract" &&
				afterInbound.languageName === "fr" &&
				tagsAfterInbound.some((row) => row.tagName === "local") &&
				membershipsAfterInbound.some(
					(row) => row.collectionKey === nativeCollection.key,
				),
			"Inbound sync overwrote dirty metadata or foreign collection memberships",
		);

		const retainedDraft = await openItemDraft(
			db,
			itemKey,
			writebackPolicyOptions,
		);
		await db
			.update(itemSourceLink)
			.set({ writebackEnabled: false })
			.where(
				and(
					eq(itemSourceLink.itemKey, itemKey),
					eq(itemSourceLink.sourceConnectionKey, connectionKey),
				),
			);
		assert(
			(await getItemDraft(db, itemKey)).draftRevision ===
				retainedDraft.draftRevision,
			"An existing draft became unreadable after writeback was disabled",
		);
		await discardItemDraft(db, itemKey);
		await db
			.update(itemSourceLink)
			.set({ writebackEnabled: true })
			.where(
				and(
					eq(itemSourceLink.itemKey, itemKey),
					eq(itemSourceLink.sourceConnectionKey, connectionKey),
				),
			);

		if (baseUrl) {
			const detailResponse = await adminRequest<{
				item: { editable: boolean };
			}>(`/api/admin/items/${itemKey}`);
			assert(
				detailResponse.item?.editable === true,
				"The admin detail endpoint did not expose writeback editability",
			);
			const openedResponse = await adminRequest<{
				draft: Awaited<ReturnType<typeof openItemDraft>>;
			}>(`/api/admin/items/${itemKey}/draft`, { method: "POST" }, 201);
			const httpDraft = openedResponse.draft;
			const savedResponse = await adminRequest<{
				draft: Awaited<ReturnType<typeof saveItemDraft>>;
			}>(`/api/admin/items/${itemKey}/draft`, {
				body: JSON.stringify({
					expectedDraftRevision: httpDraft.draftRevision,
					expectedPayload: httpDraft.payload,
					payload: {
						...httpDraft.payload,
						abstractNote: "Edited through the admin API",
					},
				}),
				method: "PUT",
			});
			assert(
				savedResponse.draft?.payload?.abstractNote ===
					"Edited through the admin API",
				"The admin draft endpoint did not save linked metadata",
			);
			await adminRequest<unknown>(`/api/admin/items/${itemKey}/publish`, {
				method: "POST",
			});
			const [afterHttpPublish] = await db
				.select()
				.from(itemSourceLink)
				.where(
					and(
						eq(itemSourceLink.itemKey, itemKey),
						eq(itemSourceLink.sourceConnectionKey, connectionKey),
					),
				);
			assert(
				afterHttpPublish?.dirtyFields.includes("abstractNote"),
				"HTTP publication did not mark its changed field for writeback",
			);
		}

		await db
			.update(item)
			.set({ deleted: 1, deletedAt: new Date() })
			.where(eq(item.key, itemKey));
		await db
			.update(itemSourceLink)
			.set({ dirtyFields: [], remoteDeleted: true })
			.where(eq(itemSourceLink.itemKey, itemKey));
		await openItemDraft(db, itemKey, writebackPolicyOptions);
		await publishItemDraft(db, itemKey, writebackPolicyOptions);
		const restoredLinks = await db
			.select()
			.from(itemSourceLink)
			.where(eq(itemSourceLink.itemKey, itemKey));
		assert(
			restoredLinks.every(
				(link) =>
					link.dirtyFields.includes("title") &&
					link.dirtyFields.includes("tags"),
			),
			"Restoring a remotely deleted item did not request remote recreation",
		);

		const nativeParentDraft = await createNativeItemDraft(db, {
			collections: [],
			itemType: "report",
			tags: [],
			title: "Linked native parent",
		});
		nativeParentKey = nativeParentDraft.itemKey;
		await publishItemDraft(db, nativeParentKey);
		await db.insert(itemSourceLink).values({
			itemKey: nativeParentKey,
			sourceConnectionKey: connectionKey,
			sourceRecordKey: "PARN2345",
		});
		const linkedNativeEdit = await openItemDraft(db, nativeParentKey);
		await saveItemDraft(db, {
			expectedDraftRevision: linkedNativeEdit.draftRevision,
			expectedPayload: linkedNativeEdit.payload,
			itemKey: nativeParentKey,
			payload: {
				...linkedNativeEdit.payload,
				title: "Protected linked native parent",
			},
		});
		await publishItemDraft(db, nativeParentKey);
		const [linkedNativeLink] = await db
			.select()
			.from(itemSourceLink)
			.where(
				and(
					eq(itemSourceLink.itemKey, nativeParentKey),
					eq(itemSourceLink.sourceConnectionKey, connectionKey),
				),
			);
		assert(
			linkedNativeLink?.dirtyFields.includes("title"),
			"A native item with a writeback-disabled link did not protect its edit",
		);
		await writeSourceIngestionBatch(db, {
			...batch(3, 4),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "PARN2345",
					remoteVersion: "4",
					raw: { key: "PARN2345", version: 4 },
					metadata: {
						itemType: "Report",
						title: "Remote view of linked parent",
					},
				},
				{
					operation: "upsert",
					sourceRecordKey: "CHLD2345",
					remoteVersion: "4",
					raw: { key: "CHLD2345", version: 4 },
					metadata: {
						itemType: "Attachment",
						title: "Remote child",
					},
					parentSourceRecordKey: "PARN2345",
				},
			],
		});
		const [linkedNativeAfterInbound] = await db
			.select({ title: item.title })
			.from(item)
			.where(eq(item.key, nativeParentKey));
		assert(
			linkedNativeAfterInbound?.title ===
				"Protected linked native parent",
			"Inbound sync overwrote a linked native item's local edit",
		);
		let childGuarded = false;
		try {
			await removeNativeItem(db, nativeParentKey);
		} catch (error) {
			childGuarded = error instanceof ItemHasChildrenError;
		}
		assert(
			childGuarded,
			"A linked native parent was deleted while it had a live remote-owned child",
		);

		console.log(
			JSON.stringify({
				childGuarded,
				dirtyFields: publishedLink?.dirtyFields,
				importedItemKey: itemKey,
				nativeCollectionPreserved: true,
				rebasedDraft: true,
				httpVerified: Boolean(baseUrl),
			}),
		);
	} finally {
		const linkedRows = await db
			.select({ itemKey: itemSourceLink.itemKey })
			.from(itemSourceLink)
			.where(eq(itemSourceLink.sourceConnectionKey, connectionKey));
		const itemKeys = [
			...new Set([
				...linkedRows.map((row) => row.itemKey),
				...(nativeParentKey ? [nativeParentKey] : []),
			]),
		];
		if (itemKeys.length > 0) {
			await db.delete(outbox).where(inArray(outbox.entityKey, itemKeys));
			await db
				.delete(itemToCollection)
				.where(inArray(itemToCollection.itemKey, itemKeys));
			await db
				.delete(itemToTag)
				.where(inArray(itemToTag.itemKey, itemKeys));
			await db.delete(item).where(inArray(item.key, itemKeys));
			await db
				.delete(itemIdentity)
				.where(inArray(itemIdentity.key, itemKeys));
		}
		if (nativeCollectionKey) {
			await db
				.delete(outbox)
				.where(eq(outbox.entityKey, nativeCollectionKey));
			await db
				.delete(collection)
				.where(eq(collection.key, nativeCollectionKey));
			await db
				.delete(collectionIdentity)
				.where(eq(collectionIdentity.key, nativeCollectionKey));
		}
		await db
			.delete(sourceConnection)
			.where(
				inArray(sourceConnection.key, [
					connectionKey,
					secondaryConnectionKey,
				]),
			);
		await resource.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
