import {
	collectionIdentity,
	itemIdentity,
	itemSourceLink,
	outbox,
	sourceConnection,
	sourceFileCleanup,
	sourceRecordIssue,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import {
	itemFilePublication,
	sourceRecordAlias,
	sourceSnapshot,
} from "../src/db/schema/source";
import { collection } from "../src/db/schema/tables/collection";
import { adminItemListProjection } from "../src/db/schema/tables/adminItemListProjection";
import { item } from "../src/db/schema/tables/item";
import { itemToCollection } from "../src/db/schema/tables/itemToCollection";
import { itemToTag } from "../src/db/schema/tables/itemToTag";
import { tag } from "../src/db/schema/tables/tag";
import type { EvidenceFileStorage } from "../src/lib/admin/file-storage";
import {
	SourceAliasConflictError,
	SourceCursorConflictError,
	SourceFileStagingConflictError,
	SourceReferenceNotFoundError,
	SourceRelationshipCycleError,
	writeSourceIngestionBatch,
} from "../src/lib/source-ingestion/transactional-writer";
import { flushSourceFileCleanup } from "../src/lib/source-ingestion/zotero/attachment-processor";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;

const connectionKeys = [
	"mendeley-writer",
	"zotero-writer",
	"zotero-unpublish-writer",
	"zotero-staging-writer",
	"zotero-native-link-writer",
];
const tagNames = ["attachment-tag", "parent-tag", "restored-tag"];
const nativeLinkItemKey = "NATV2345";

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
			{
				key: "zotero-unpublish-writer",
				provider: "zotero",
				scopeKind: "group",
				externalScopeKey: "writer-zotero-unpublish",
			},
			{
				key: "zotero-staging-writer",
				provider: "zotero",
				scopeKind: "group",
				externalScopeKey: "writer-zotero-staging",
			},
			{
				key: "zotero-native-link-writer",
				provider: "zotero",
				scopeKind: "group",
				externalScopeKey: "writer-zotero-native-link",
			},
		]);

		await db.insert(itemIdentity).values({
			key: nativeLinkItemKey,
			sourceConnectionKey: "native",
			sourceRecordKey: nativeLinkItemKey,
		});
		await db.insert(item).values({
			key: nativeLinkItemKey,
			itemType: "Report",
			sourceConnectionKey: "native",
			sourceRecordKey: nativeLinkItemKey,
			title: "Local title",
		});
		await db.insert(itemSourceLink).values({
			dirtyFields: ["title"],
			itemKey: nativeLinkItemKey,
			sourceConnectionKey: "zotero-native-link-writer",
			sourceRecordKey: "LINK2345",
			writebackEnabled: true,
		});

		const linkedRecord = {
			operation: "upsert" as const,
			sourceRecordKey: "LINK2345",
			remoteVersion: "1",
			raw: { key: "LINK2345", version: 1 },
			metadata: {
				abstractNote: "Remote abstract",
				itemType: "Report",
				title: "Remote title",
			},
		};
		const linkedFirst = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-native-link-writer",
				expectedCursor: {},
				nextCursor: { version: 1 },
			}),
			items: [linkedRecord],
		});
		assert(
			linkedFirst.itemKeys.LINK2345 === nativeLinkItemKey,
			"A linked native item was duplicated during source resolution",
		);
		const [linkedAfterFirst] = await db
			.select()
			.from(item)
			.where(eq(item.key, nativeLinkItemKey));
		assert(
			linkedAfterFirst?.sourceConnectionKey === "native" &&
				linkedAfterFirst.title === "Local title" &&
				linkedAfterFirst.abstractNote === "Remote abstract" &&
				linkedAfterFirst.revision === 2,
			"Inbound sync did not preserve ownership and dirty fields",
		);

		const versionOnly = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-native-link-writer",
				expectedCursor: { version: 1 },
				nextCursor: { version: 2 },
			}),
			fetchedAt: new Date("2026-07-29T12:05:00.000Z"),
			items: [
				{
					...linkedRecord,
					remoteVersion: "2",
					raw: { key: "LINK2345", version: 2 },
				},
			],
		});
		assert(
			versionOnly.written.items === 0 &&
				versionOnly.written.outboxEvents === 0,
			"A remote-version-only update bumped the canonical revision",
		);

		const dirtyOnly = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-native-link-writer",
				expectedCursor: { version: 2 },
				nextCursor: { version: 3 },
			}),
			items: [
				{
					...linkedRecord,
					remoteVersion: "3",
					raw: { key: "LINK2345", version: 3 },
					metadata: {
						...linkedRecord.metadata,
						title: "Another remote title",
					},
				},
			],
		});
		assert(
			dirtyOnly.written.items === 0 &&
				dirtyOnly.written.outboxEvents === 0,
			"A remote change confined to dirty fields bumped the canonical revision",
		);

		const unmaskedChange = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-native-link-writer",
				expectedCursor: { version: 3 },
				nextCursor: { version: 4 },
			}),
			items: [
				{
					...linkedRecord,
					remoteVersion: "4",
					raw: { key: "LINK2345", version: 4 },
					metadata: {
						...linkedRecord.metadata,
						abstractNote: "Updated remote abstract",
						title: "Another remote title",
					},
				},
			],
		});
		const [[linkedAfterUpdate], [linkedSourceLink], [linkedSnapshot]] =
			await Promise.all([
				db.select().from(item).where(eq(item.key, nativeLinkItemKey)),
				db
					.select()
					.from(itemSourceLink)
					.where(
						and(
							eq(itemSourceLink.itemKey, nativeLinkItemKey),
							eq(
								itemSourceLink.sourceConnectionKey,
								"zotero-native-link-writer",
							),
						),
					),
				db
					.select()
					.from(sourceSnapshot)
					.where(
						and(
							eq(sourceSnapshot.itemKey, nativeLinkItemKey),
							eq(
								sourceSnapshot.sourceConnectionKey,
								"zotero-native-link-writer",
							),
						),
					),
			]);
		assert(
			unmaskedChange.written.items === 1 &&
				linkedAfterUpdate?.title === "Local title" &&
				linkedAfterUpdate.abstractNote === "Updated remote abstract" &&
				linkedAfterUpdate.revision === 3 &&
				linkedSourceLink?.remoteVersion === "4" &&
				linkedSourceLink.lastAcknowledgedRemoteVersion === "4" &&
				linkedSnapshot?.remoteVersion === "4",
			"Link-scoped snapshots or dirty-field masking were not maintained",
		);

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

		let stagingConflict = false;
		try {
			await writeSourceIngestionBatch(db, {
				...baseBatch({
					connectionKey: "zotero-staging-writer",
					expectedCursor: {},
					nextCursor: { version: 1 },
				}),
				items: [
					{
						operation: "upsert",
						sourceRecordKey: "STAGEP01",
						remoteVersion: "1",
						raw: { key: "STAGEP01", version: 1 },
						metadata: {
							itemType: "Report",
							title: "Staging conflict parent",
						},
					},
					{
						operation: "upsert",
						sourceRecordKey: "STAGEA01",
						remoteVersion: "1",
						raw: { key: "STAGEA01", version: 1 },
						metadata: {
							itemType: "Attachment",
							title: "Staging conflict PDF",
						},
						parentSourceRecordKey: "STAGEP01",
						file: {
							url: "https://storage.example.org/staging.pdf",
							contentType: "application/pdf",
							filename: "staging.pdf",
							linkMode: "imported_file",
							md5: "d".repeat(32),
							fullText: "Staging conflict",
							coverUrl: "https://storage.example.org/staging.png",
							coverWidth: 1200,
							coverHeight: 1600,
							managedPublication: {
								objectPath:
									"sources/zotero/zotero-staging-writer/STAGEA01/dddddddddddddddddddddddddddddddd/document.pdf",
								coverObjectPath:
									"sources/zotero/zotero-staging-writer/STAGEA01/dddddddddddddddddddddddddddddddd/cover.png",
								sizeBytes: 20,
								sha256: "d".repeat(64),
								pageCount: 1,
								staged: true,
							},
						},
					},
				],
			});
		} catch (error) {
			stagingConflict = error instanceof SourceFileStagingConflictError;
		}
		assert(
			stagingConflict,
			"A missing upload-staging row did not abort the source transaction",
		);
		const stagedConflictIdentities = await db
			.select()
			.from(itemIdentity)
			.where(
				eq(itemIdentity.sourceConnectionKey, "zotero-staging-writer"),
			);
		assert(
			stagedConflictIdentities.length === 0,
			"A staging conflict left partially committed item identities",
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
						coverUrl: "https://storage.example.org/evidence.png",
						coverWidth: 1200,
						coverHeight: 1600,
						managedPublication: {
							objectPath:
								"sources/zotero/zotero-writer/BBBB2345/example-md5/document.pdf",
							coverObjectPath:
								"sources/zotero/zotero-writer/BBBB2345/example-md5/cover.png",
							sizeBytes: 1234,
							sha256: "a".repeat(64),
							pageCount: 3,
							staged: false,
						},
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
				.where(eq(collection.key, first.collectionKeys.DDDD2345!))
				.then((rows) => rows[0]),
		]);
		assert(
			parent?.revision === 1 &&
				attachment?.parentItem === parentKey &&
				attachment.url === "https://storage.example.org/evidence.pdf" &&
				attachment.fullTextPDF === "Extracted evidence",
			"Canonical item or attachment fields were written incorrectly",
		);
		const projectedRows = await db
			.select({ key: adminItemListProjection.key })
			.from(adminItemListProjection)
			.where(
				inArray(adminItemListProjection.key, [
					parentKey,
					attachmentKey,
				]),
			);
		assert(
			projectedRows.length === 1 && projectedRows[0]?.key === parentKey,
			"Source attachment reparenting left a stale root projection",
		);
		assert(
			childCollection?.parentCollection === first.collectionKeys.CCCC2345,
			"Two-pass collection parenting failed",
		);

		const [memberships, tags, snapshot, alias, publication] =
			await Promise.all([
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
				db
					.select()
					.from(itemFilePublication)
					.where(eq(itemFilePublication.itemKey, attachmentKey))
					.then((rows) => rows[0]),
			]);
		assert(
			memberships.length === 2 &&
				tags.length === 1 &&
				tags[0]?.tagName === "attachment-tag" &&
				snapshot?.payloadHash.length === 64 &&
				alias?.itemKey === parentKey &&
				publication?.sourceConnectionKey === "zotero-writer" &&
				publication.parentItemKey === parentKey &&
				publication.sha256 === "a".repeat(64),
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
					processingIssue: {
						code: "zotero_file_unavailable",
						message: "Temporary fixture issue",
					},
				},
			],
		});
		assert(
			attachmentUpdate.written.items === 2,
			"Attachment update did not reproject its parent",
		);
		const [savedIssue] = await db
			.select()
			.from(sourceRecordIssue)
			.where(
				and(
					eq(sourceRecordIssue.sourceConnectionKey, "zotero-writer"),
					eq(sourceRecordIssue.sourceRecordKey, "BBBB2345"),
				),
			);
		assert(
			savedIssue?.code === "zotero_file_unavailable",
			"A source record processing issue was not persisted with the batch",
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
			aliasConflictRejected = error instanceof SourceAliasConflictError;
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
			cycleRejected = error instanceof SourceRelationshipCycleError;
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
		const unresolvedIssue = await db
			.select()
			.from(sourceRecordIssue)
			.where(
				and(
					eq(sourceRecordIssue.sourceConnectionKey, "zotero-writer"),
					eq(sourceRecordIssue.sourceRecordKey, "BBBB2345"),
				),
			);
		assert(
			unresolvedIssue.length === 0,
			"A source record issue was not resolved by a later successful batch",
		);
		const [deletedPublication, queuedCleanup] = await Promise.all([
			db
				.select()
				.from(itemFilePublication)
				.where(eq(itemFilePublication.itemKey, attachmentKey)),
			db
				.select()
				.from(sourceFileCleanup)
				.where(
					eq(sourceFileCleanup.sourceConnectionKey, "zotero-writer"),
				),
		]);
		assert(
			deletedPublication.length === 0 && queuedCleanup.length === 2,
			"Deleting a managed source PDF did not durably queue both public objects",
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
		const [restoredPublication, staleCleanup] = await Promise.all([
			db
				.select()
				.from(itemFilePublication)
				.where(eq(itemFilePublication.itemKey, attachmentKey)),
			db
				.select()
				.from(sourceFileCleanup)
				.where(
					eq(sourceFileCleanup.sourceConnectionKey, "zotero-writer"),
				),
		]);
		assert(
			restoredPublication.length === 1 && staleCleanup.length === 0,
			"Restoring content-addressed source paths left an unsafe pending cleanup",
		);
		const retryPaths = [
			"sources/zotero/zotero-writer/obsolete/document.pdf",
			"sources/zotero/zotero-writer/obsolete/cover.png",
		];
		await db.insert(sourceFileCleanup).values(
			retryPaths.map((objectPath) => ({
				sourceConnectionKey: "zotero-writer",
				objectPath,
			})),
		);
		let cleanupShouldFail = true;
		const removedPaths: string[] = [];
		const cleanupStorage = {
			async removePublic(paths: string[]) {
				if (cleanupShouldFail)
					throw new Error("temporary storage outage");
				removedPaths.push(...paths);
			},
		} as unknown as EvidenceFileStorage;
		let cleanupFailed = false;
		try {
			await flushSourceFileCleanup(db, cleanupStorage, "zotero-writer");
		} catch {
			cleanupFailed = true;
		}
		const failedCleanup = await db
			.select()
			.from(sourceFileCleanup)
			.where(eq(sourceFileCleanup.sourceConnectionKey, "zotero-writer"));
		assert(
			cleanupFailed &&
				failedCleanup.length === 2 &&
				failedCleanup.every(
					(row) =>
						row.attempts === 1 &&
						row.lastError === "temporary storage outage",
				),
			"A failed source-file cleanup was not retained for retry",
		);
		cleanupShouldFail = false;
		await flushSourceFileCleanup(db, cleanupStorage, "zotero-writer");
		const completedCleanup = await db
			.select()
			.from(sourceFileCleanup)
			.where(eq(sourceFileCleanup.sourceConnectionKey, "zotero-writer"));
		assert(
			completedCleanup.length === 0 &&
				removedPaths.sort().join("\n") === retryPaths.sort().join("\n"),
			"A retained source-file cleanup did not complete on retry",
		);
		await db.insert(sourceFileCleanup).values({
			sourceConnectionKey: "zotero-writer",
			objectPath: "sources/zotero/zotero-writer/poison.pdf",
		});
		const permanentlyFailingStorage = {
			async removePublic() {
				throw new Error("permanent object failure");
			},
		} as unknown as EvidenceFileStorage;
		for (let attempt = 0; attempt < 5; attempt += 1) {
			try {
				await flushSourceFileCleanup(
					db,
					permanentlyFailingStorage,
					"zotero-writer",
				);
			} catch {
				if (attempt === 4) {
					throw new Error(
						"Cleanup remained retryable after its attempt cap",
					);
				}
			}
		}
		const [deadLetteredCleanup] = await db
			.select()
			.from(sourceFileCleanup)
			.where(eq(sourceFileCleanup.sourceConnectionKey, "zotero-writer"));
		assert(
			deadLetteredCleanup?.attempts === 5 &&
				Boolean(deadLetteredCleanup.deadLetteredAt),
			"A poison cleanup object was not dead-lettered after five attempts",
		);

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
					eq(itemIdentity.sourceConnectionKey, "zotero-writer"),
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
						collections: [{ sourceRecordKey: "MISSING1" }],
					},
				],
			});
		} catch (error) {
			missingReferenceRejected =
				error instanceof SourceReferenceNotFoundError;
		}
		assert(missingReferenceRejected, "A missing relationship was accepted");
		const [rolledBackIdentity, zoteroConnection] = await Promise.all([
			db
				.select()
				.from(itemIdentity)
				.where(
					and(
						eq(itemIdentity.sourceConnectionKey, "zotero-writer"),
						eq(itemIdentity.sourceRecordKey, "HHHH2345"),
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

		const publicationLifecycle = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-unpublish-writer",
				expectedCursor: {},
				nextCursor: { version: 1 },
			}),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "PUBP0001",
					remoteVersion: "1",
					raw: { key: "PUBP0001" },
					metadata: {
						itemType: "Report",
						title: "Publication parent",
					},
				},
				{
					operation: "upsert",
					sourceRecordKey: "PUBA0001",
					remoteVersion: "1",
					raw: { key: "PUBA0001" },
					metadata: {
						itemType: "Attachment",
						title: "Publication PDF",
					},
					parentSourceRecordKey: "PUBP0001",
					file: {
						url: "https://storage.example.org/publication.pdf",
						contentType: "application/pdf",
						filename: "publication.pdf",
						linkMode: "imported_file",
						md5: "publication-md5",
						mtime: "1",
						fullText: "Publication text",
						coverUrl: "https://storage.example.org/publication.png",
						coverWidth: 1200,
						coverHeight: 1600,
						managedPublication: {
							objectPath: "sources/zotero/unpublish/document.pdf",
							coverObjectPath:
								"sources/zotero/unpublish/cover.png",
							sizeBytes: 20,
							sha256: "c".repeat(64),
							pageCount: 1,
							staged: false,
						},
					},
				},
			],
		});
		const publicationAttachmentKey =
			publicationLifecycle.itemKeys.PUBA0001!;
		await db.insert(sourceFileCleanup).values(
			[
				"sources/zotero/unpublish/document.pdf",
				"sources/zotero/unpublish/cover.png",
			].map((objectPath) => ({
				attempts: 5,
				deadLetteredAt: new Date(),
				lastError: "simulated prior cleanup failure",
				objectPath,
				sourceConnectionKey: "zotero-unpublish-writer",
			})),
		);
		await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-unpublish-writer",
				expectedCursor: { version: 1 },
				nextCursor: { version: 2 },
			}),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "PUBA0001",
					remoteVersion: "2",
					raw: { key: "PUBA0001", tags: [] },
					metadata: { itemType: "Attachment", title: "Private PDF" },
					parentSourceRecordKey: "PUBP0001",
					file: {
						url: null,
						contentType: "application/pdf",
						filename: "publication.pdf",
						linkMode: "imported_file",
						md5: "publication-md5",
						mtime: "1",
						charset: null,
						fullText: null,
						coverUrl: null,
						coverWidth: null,
						coverHeight: null,
						managedPublication: null,
					},
				},
			],
		});
		const [unpublishedAttachment, unpublishedLedger, unpublishCleanup] =
			await Promise.all([
				db
					.select()
					.from(item)
					.where(eq(item.key, publicationAttachmentKey))
					.then((rows) => rows[0]),
				db
					.select()
					.from(itemFilePublication)
					.where(
						eq(
							itemFilePublication.itemKey,
							publicationAttachmentKey,
						),
					),
				db
					.select()
					.from(sourceFileCleanup)
					.where(
						eq(
							sourceFileCleanup.sourceConnectionKey,
							"zotero-unpublish-writer",
						),
					),
			]);
		assert(
			unpublishedAttachment?.url === null &&
				unpublishedAttachment.fullTextPDF === null &&
				unpublishedLedger.length === 0 &&
				unpublishCleanup.length === 2 &&
				unpublishCleanup.every(
					(row) =>
						row.attempts === 0 &&
						row.deadLetteredAt === null &&
						row.lastError === null,
				),
			"Removing a publication tag did not clear and queue the managed PDF bundle",
		);

		await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-unpublish-writer",
				expectedCursor: { version: 2 },
				nextCursor: { version: 3 },
			}),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "PUBA0001",
					remoteVersion: "3",
					raw: { key: "PUBA0001", tags: ["purple-publish"] },
					metadata: {
						itemType: "Attachment",
						title: "Republished PDF",
					},
					parentSourceRecordKey: "PUBP0001",
					file: {
						url: "https://storage.example.org/publication.pdf",
						contentType: "application/pdf",
						filename: "publication.pdf",
						linkMode: "imported_file",
						md5: "publication-md5",
						mtime: "1",
						fullText: "Publication text",
						coverUrl: "https://storage.example.org/publication.png",
						coverWidth: 1200,
						coverHeight: 1600,
						managedPublication: {
							objectPath: "sources/zotero/unpublish/document.pdf",
							coverObjectPath:
								"sources/zotero/unpublish/cover.png",
							sizeBytes: 20,
							sha256: "c".repeat(64),
							pageCount: 1,
							staged: false,
						},
					},
				},
			],
		});
		await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-unpublish-writer",
				expectedCursor: { version: 3 },
				nextCursor: { version: 4 },
			}),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "PUBA0001",
					remoteVersion: "4",
					raw: { key: "PUBA0001", itemType: "report" },
					metadata: {
						itemType: "Report",
						title: "Converted source record",
					},
					file: null,
				},
			],
		});
		const [convertedItem, convertedLedger, convertedCleanup] =
			await Promise.all([
				db
					.select()
					.from(item)
					.where(eq(item.key, publicationAttachmentKey))
					.then((rows) => rows[0]),
				db
					.select()
					.from(itemFilePublication)
					.where(
						eq(
							itemFilePublication.itemKey,
							publicationAttachmentKey,
						),
					),
				db
					.select()
					.from(sourceFileCleanup)
					.where(
						eq(
							sourceFileCleanup.sourceConnectionKey,
							"zotero-unpublish-writer",
						),
					),
			]);
		assert(
			convertedItem?.itemType === "Report" &&
				convertedLedger.length === 0 &&
				convertedCleanup.length === 2,
			"A file-null source upsert orphaned its managed publication",
		);

		const writerEvents = await db
			.select()
			.from(outbox)
			.where(inArray(outbox.entityKey, [parentKey, attachmentKey]))
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
			.where(inArray(itemIdentity.sourceConnectionKey, connectionKeys));
		const itemKeys = [
			...identities.map(({ key }) => key),
			nativeLinkItemKey,
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
		}
		const collectionIdentities = await db
			.select({ key: collectionIdentity.key })
			.from(collectionIdentity)
			.where(
				inArray(collectionIdentity.sourceConnectionKey, connectionKeys),
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
			.where(inArray(itemIdentity.sourceConnectionKey, connectionKeys));
		await db
			.delete(itemIdentity)
			.where(eq(itemIdentity.key, nativeLinkItemKey));
		await db
			.delete(collectionIdentity)
			.where(
				inArray(collectionIdentity.sourceConnectionKey, connectionKeys),
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
