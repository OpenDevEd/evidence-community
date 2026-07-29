import {
	collectionIdentity,
	itemIdentity,
	outbox,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import {
	sourceRecordAlias,
	sourceSnapshot,
} from "../src/db/schema/source";
import { collection } from "../src/db/schema/tables/collection";
import { item } from "../src/db/schema/tables/item";
import { itemToCollection } from "../src/db/schema/tables/itemToCollection";
import { itemToTag } from "../src/db/schema/tables/itemToTag";
import { tag } from "../src/db/schema/tables/tag";
import {
	SourceAliasConflictError,
	SourceCursorConflictError,
	SourceReferenceNotFoundError,
	SourceRelationshipCycleError,
	writeSourceIngestionBatch,
} from "../src/lib/source-ingestion/transactional-writer";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;

const connectionKeys = ["mendeley-writer", "zotero-writer"];
const tagNames = ["attachment-tag", "parent-tag", "restored-tag"];

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function baseBatch({
	connectionKey,
	expectedCursor,
	nextCursor,
}: {
	connectionKey: string;
	expectedCursor: Record<string, unknown>;
	nextCursor: Record<string, unknown>;
}) {
	return {
		sourceConnectionKey: connectionKey,
		expectedCursor,
		nextCursor,
		mappingProfileVersion: "canonical-v1",
		fetchedAt: new Date("2026-07-29T12:00:00.000Z"),
		collections: [],
		items: [],
	};
}

async function verify() {
	const resource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const db = resource.database;

	try {
		await db.insert(sourceConnection).values([
			{
				key: "mendeley-writer",
				provider: "mendeley",
				scopeKind: "group",
				externalScopeKey: "writer-mendeley",
			},
			{
				key: "zotero-writer",
				provider: "zotero",
				scopeKind: "group",
				externalScopeKey: "writer-zotero",
			},
		]);

		const mendeleyResult = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "mendeley-writer",
				expectedCursor: {},
				nextCursor: { page: 1 },
			}),
			collections: [
				{
					operation: "upsert",
					sourceRecordKey: "SHARED01",
					data: { name: "Shared evidence" },
				},
			],
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "AAAA2345",
					remoteVersion: "1",
					raw: { id: "AAAA2345", version: 1 },
					metadata: {
						itemType: "Document",
						title: "Mendeley collision owner",
					},
				},
			],
		});
		assert(
			mendeleyResult.itemKeys.AAAA2345 === "AAAA2345",
			"An available provider key was not adopted",
		);

		const firstBatch = {
			...baseBatch({
				connectionKey: "zotero-writer",
				expectedCursor: {},
				nextCursor: { version: 1 },
			}),
			collections: [
				{
					operation: "upsert",
					sourceRecordKey: "CCCC2345",
					data: {
						name: "Root collection",
						numCollections: 1,
						numItems: 1,
						relations: { type: "root" },
					},
				},
				{
					operation: "upsert",
					sourceRecordKey: "DDDD2345",
					parentSourceRecordKey: "CCCC2345",
					data: {
						name: "Child collection",
						numCollections: 0,
						numItems: 1,
					},
				},
			],
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "AAAA2345",
					remoteVersion: "10",
					raw: { key: "AAAA2345", version: 10 },
					metadata: {
						itemType: "Report",
						title: "Zotero parent",
						tags: ["parent-tag"],
					},
					aliases: [
						{
							key: "zotero:group:AAAA2345",
							kind: "provider-uri",
						},
					],
				},
				{
					operation: "upsert",
					sourceRecordKey: "BBBB2345",
					remoteVersion: "11",
					raw: { key: "BBBB2345", version: 11 },
					metadata: {
						itemType: "Attachment",
						title: "Published PDF",
						tags: ["attachment-tag"],
					},
					parentSourceRecordKey: "AAAA2345",
					collections: [
						{ sourceRecordKey: "DDDD2345" },
						{
							sourceConnectionKey: "mendeley-writer",
							sourceRecordKey: "SHARED01",
						},
					],
					file: {
						url: "https://storage.example.org/evidence.pdf",
						contentType: "application/pdf",
						filename: "evidence.pdf",
						linkMode: "imported_file",
						md5: "example-md5",
						mtime: "1722254400000",
						fullText: "Extracted evidence",
						coverUrl:
							"https://storage.example.org/evidence.png",
						coverWidth: 1200,
						coverHeight: 1600,
					},
				},
			],
		};
		const first = await writeSourceIngestionBatch(db, firstBatch);
		const parentKey = first.itemKeys.AAAA2345!;
		const attachmentKey = first.itemKeys.BBBB2345!;
		assert(
			parentKey !== "AAAA2345",
			"A colliding provider key was not remapped",
		);
		assert(
			attachmentKey === "BBBB2345",
			"An unclaimed provider key was not adopted",
		);

		const [parent, attachment, childCollection] = await Promise.all([
			db
				.select()
				.from(item)
				.where(eq(item.key, parentKey))
				.then((rows) => rows[0]),
			db
				.select()
				.from(item)
				.where(eq(item.key, attachmentKey))
				.then((rows) => rows[0]),
			db
				.select()
				.from(collection)
				.where(
					eq(
						collection.key,
						first.collectionKeys.DDDD2345!,
					),
				)
				.then((rows) => rows[0]),
		]);
		assert(
			parent?.revision === 1 &&
				attachment?.parentItem === parentKey &&
				attachment.url ===
					"https://storage.example.org/evidence.pdf" &&
				attachment.fullTextPDF === "Extracted evidence",
			"Canonical item or attachment fields were written incorrectly",
		);
		assert(
			childCollection?.parentCollection ===
				first.collectionKeys.CCCC2345,
			"Two-pass collection parenting failed",
		);

		const [memberships, tags, snapshot, alias] = await Promise.all([
			db
				.select()
				.from(itemToCollection)
				.where(eq(itemToCollection.itemKey, attachmentKey)),
			db
				.select()
				.from(itemToTag)
				.where(eq(itemToTag.itemKey, attachmentKey)),
			db
				.select()
				.from(sourceSnapshot)
				.where(eq(sourceSnapshot.itemKey, attachmentKey))
				.then((rows) => rows[0]),
			db
				.select()
				.from(sourceRecordAlias)
				.where(
					and(
						eq(
							sourceRecordAlias.sourceConnectionKey,
							"zotero-writer",
						),
						eq(
							sourceRecordAlias.aliasKey,
							"zotero:group:AAAA2345",
						),
					),
				)
				.then((rows) => rows[0]),
		]);
		assert(
			memberships.length === 2 &&
				tags.length === 1 &&
				tags[0]?.tagName === "attachment-tag" &&
				snapshot?.payloadHash.length === 64 &&
				alias?.itemKey === parentKey,
			"Normalized relationships, snapshot, or alias is wrong",
		);

		const replay = await writeSourceIngestionBatch(db, {
			...firstBatch,
			expectedCursor: { version: 1 },
			nextCursor: { version: 2 },
			fetchedAt: new Date("2026-07-29T12:05:00.000Z"),
		});
		assert(
			replay.written.items === 0 &&
				replay.written.collections === 0 &&
				replay.written.outboxEvents === 0,
			"An identical replay created canonical revisions",
		);

		const attachmentUpdate = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-writer",
				expectedCursor: { version: 2 },
				nextCursor: { version: 3 },
			}),
			items: [
				{
					...firstBatch.items[1],
					remoteVersion: "12",
					raw: { key: "BBBB2345", version: 12 },
					metadata: {
						itemType: "Attachment",
						title: "Updated PDF",
						tags: ["attachment-tag"],
					},
				},
			],
		});
		assert(
			attachmentUpdate.written.items === 2,
			"Attachment update did not reproject its parent",
		);

		let staleRejected = false;
		try {
			await writeSourceIngestionBatch(db, {
				...baseBatch({
					connectionKey: "zotero-writer",
					expectedCursor: { version: 2 },
					nextCursor: { version: 99 },
				}),
			});
		} catch (error) {
			staleRejected = error instanceof SourceCursorConflictError;
		}
		assert(staleRejected, "A stale source cursor was accepted");

		let aliasConflictRejected = false;
		try {
			await writeSourceIngestionBatch(db, {
				...baseBatch({
					connectionKey: "zotero-writer",
					expectedCursor: { version: 3 },
					nextCursor: { version: 4 },
				}),
				items: [
					{
						operation: "upsert",
						sourceRecordKey: "EEEE2345",
						raw: { key: "EEEE2345" },
						metadata: {
							itemType: "Document",
							title: "Alias thief",
						},
						aliases: [
							{
								key: "zotero:group:AAAA2345",
								kind: "provider-uri",
							},
						],
					},
				],
			});
		} catch (error) {
			aliasConflictRejected =
				error instanceof SourceAliasConflictError;
		}
		assert(aliasConflictRejected, "An alias was reassigned");

		let cycleRejected = false;
		try {
			await writeSourceIngestionBatch(db, {
				...baseBatch({
					connectionKey: "zotero-writer",
					expectedCursor: { version: 3 },
					nextCursor: { version: 4 },
				}),
				collections: [
					{
						operation: "upsert",
						sourceRecordKey: "FFFF2345",
						parentSourceRecordKey: "GGGG2345",
						data: { name: "Cycle one" },
					},
					{
						operation: "upsert",
						sourceRecordKey: "GGGG2345",
						parentSourceRecordKey: "FFFF2345",
						data: { name: "Cycle two" },
					},
				],
			});
		} catch (error) {
			cycleRejected =
				error instanceof SourceRelationshipCycleError;
		}
		assert(cycleRejected, "A collection parent cycle was accepted");

		const deletion = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-writer",
				expectedCursor: { version: 3 },
				nextCursor: { version: 4 },
			}),
			items: [
				{
					operation: "delete",
					sourceRecordKey: "BBBB2345",
					remoteVersion: "13",
					raw: { key: "BBBB2345", deleted: true },
				},
			],
		});
		assert(
			deletion.written.items === 2,
			"Attachment deletion did not reproject its parent",
		);
		const repeatedDeletion = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-writer",
				expectedCursor: { version: 4 },
				nextCursor: { version: 5 },
			}),
			items: [
				{
					operation: "delete",
					sourceRecordKey: "BBBB2345",
					remoteVersion: "13",
				},
			],
		});
		assert(
			repeatedDeletion.written.outboxEvents === 0,
			"Repeated deletion emitted another revision",
		);

		await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-writer",
				expectedCursor: { version: 5 },
				nextCursor: { version: 6 },
			}),
			items: [
				{
					...firstBatch.items[1],
					remoteVersion: "14",
					raw: { key: "BBBB2345", version: 14 },
					metadata: {
						itemType: "Attachment",
						title: "Restored PDF",
						tags: ["restored-tag"],
					},
				},
			],
		});

		await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-writer",
				expectedCursor: { version: 6 },
				nextCursor: { version: 7 },
			}),
			items: [
				{
					operation: "delete",
					sourceRecordKey: "UNKNOWN1",
				},
			],
		});
		const [unknownIdentity] = await db
			.select()
			.from(itemIdentity)
			.where(
				and(
					eq(
						itemIdentity.sourceConnectionKey,
						"zotero-writer",
					),
					eq(itemIdentity.sourceRecordKey, "UNKNOWN1"),
				),
			);
		assert(!unknownIdentity, "Unknown deletion reserved an identity");

		let missingReferenceRejected = false;
		try {
			await writeSourceIngestionBatch(db, {
				...baseBatch({
					connectionKey: "zotero-writer",
					expectedCursor: { version: 7 },
					nextCursor: { version: 8 },
				}),
				items: [
					{
						operation: "upsert",
						sourceRecordKey: "HHHH2345",
						raw: { key: "HHHH2345" },
						metadata: {
							itemType: "Document",
							title: "Must roll back",
						},
						collections: [
							{ sourceRecordKey: "MISSING1" },
						],
					},
				],
			});
		} catch (error) {
			missingReferenceRejected =
				error instanceof SourceReferenceNotFoundError;
		}
		assert(
			missingReferenceRejected,
			"A missing relationship was accepted",
		);
		const [rolledBackIdentity, zoteroConnection] = await Promise.all([
			db
				.select()
				.from(itemIdentity)
				.where(
					and(
						eq(
							itemIdentity.sourceConnectionKey,
							"zotero-writer",
						),
						eq(
							itemIdentity.sourceRecordKey,
							"HHHH2345",
						),
					),
				)
				.then((rows) => rows[0]),
			db
				.select()
				.from(sourceConnection)
				.where(eq(sourceConnection.key, "zotero-writer"))
				.then((rows) => rows[0]),
		]);
		assert(
			!rolledBackIdentity &&
				JSON.stringify(zoteroConnection?.syncCursor) ===
					JSON.stringify({ version: 7 }),
			"Failed source batch did not roll back identity and cursor",
		);

		await db.insert(itemIdentity).values({
			key: "JJJJ2345",
			sourceConnectionKey: "zotero-writer",
			sourceRecordKey: "ORPHANP",
		});
		let missingParentRowRejected = false;
		try {
			await writeSourceIngestionBatch(db, {
				...baseBatch({
					connectionKey: "zotero-writer",
					expectedCursor: { version: 7 },
					nextCursor: { version: 8 },
				}),
				items: [
					{
						operation: "upsert",
						sourceRecordKey: "KKKK2345",
						parentSourceRecordKey: "ORPHANP",
						raw: { key: "KKKK2345" },
						metadata: {
							itemType: "Attachment",
							title: "Missing parent row",
						},
					},
				],
			});
		} catch (error) {
			missingParentRowRejected =
				error instanceof SourceReferenceNotFoundError;
		}
		assert(
			missingParentRowRejected,
			"An identity without an active parent row leaked a raw FK error",
		);

		let sameBatchParentDeletionRejected = false;
		try {
			await writeSourceIngestionBatch(db, {
				...baseBatch({
					connectionKey: "zotero-writer",
					expectedCursor: { version: 7 },
					nextCursor: { version: 8 },
				}),
				items: [
					{
						operation: "upsert",
						sourceRecordKey: "LLLL2345",
						parentSourceRecordKey: "AAAA2345",
						raw: { key: "LLLL2345" },
						metadata: {
							itemType: "Attachment",
							title: "Invalid final parent",
						},
					},
					{
						operation: "delete",
						sourceRecordKey: "AAAA2345",
					},
				],
			});
		} catch (error) {
			sameBatchParentDeletionRejected =
				error instanceof SourceReferenceNotFoundError;
		}
		assert(
			sameBatchParentDeletionRejected,
			"A child was assigned to a parent deleted by the same batch",
		);

		await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-writer",
				expectedCursor: { version: 7 },
				nextCursor: { version: 8 },
			}),
			items: [
				{
					operation: "delete",
					sourceRecordKey: "AAAA2345",
					remoteVersion: "15",
				},
			],
		});
		await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-writer",
				expectedCursor: { version: 8 },
				nextCursor: { version: 9 },
			}),
			items: [
				{
					operation: "delete",
					sourceRecordKey: "BBBB2345",
					remoteVersion: "16",
				},
			],
		});

		const writerEvents = await db
			.select()
			.from(outbox)
			.where(
				inArray(outbox.entityKey, [
					parentKey,
					attachmentKey,
				]),
			)
			.orderBy(outbox.id);
		const parentEvents = writerEvents.filter(
			(event) => event.entityKey === parentKey,
		);
		assert(
			parentEvents.at(-1)?.operation === "delete",
			"Deleting a child resurrected its tombstoned parent in the outbox",
		);
		console.log(
			JSON.stringify({
				attachmentKey,
				collisionRemapped: parentKey !== "AAAA2345",
				crossSourceMemberships: memberships.length,
				parentKey,
				writerEvents: writerEvents.length,
			}),
		);
	} finally {
		const identities = await db
			.select({ key: itemIdentity.key })
			.from(itemIdentity)
			.where(
				inArray(
					itemIdentity.sourceConnectionKey,
					connectionKeys,
				),
			);
		const itemKeys = identities.map(({ key }) => key);
		if (itemKeys.length > 0) {
			await db
				.delete(outbox)
				.where(inArray(outbox.entityKey, itemKeys));
			await db
				.delete(itemToCollection)
				.where(inArray(itemToCollection.itemKey, itemKeys));
			await db
				.delete(itemToTag)
				.where(inArray(itemToTag.itemKey, itemKeys));
			await db.delete(item).where(inArray(item.key, itemKeys));
		}
		const collectionIdentities = await db
			.select({ key: collectionIdentity.key })
			.from(collectionIdentity)
			.where(
				inArray(
					collectionIdentity.sourceConnectionKey,
					connectionKeys,
				),
			);
		const collectionKeys = collectionIdentities.map(({ key }) => key);
		if (collectionKeys.length > 0) {
			await db
				.delete(outbox)
				.where(inArray(outbox.entityKey, collectionKeys));
			await db
				.delete(collection)
				.where(inArray(collection.key, collectionKeys));
		}
		await db
			.delete(itemIdentity)
			.where(
				inArray(
					itemIdentity.sourceConnectionKey,
					connectionKeys,
				),
			);
		await db
			.delete(collectionIdentity)
			.where(
				inArray(
					collectionIdentity.sourceConnectionKey,
					connectionKeys,
				),
			);
		await db
			.delete(sourceConnection)
			.where(inArray(sourceConnection.key, connectionKeys));
		await db.delete(tag).where(inArray(tag.name, tagNames));
		await resource.dispose();
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
