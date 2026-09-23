import { libraryConfigSchema } from "../src/config/library-config/schema";
import { maximalLibraryConfig } from "../tests/fixtures/library-config";
import {
	collectionIdentity,
	collectionSourceLink,
	collectionSourceSnapshot,
	itemIdentity,
	itemSourceLink,
	outbox,
	sourceConnection,
	sourceFileCleanup,
	sourceRecordIssue,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { itemLink } from "../src/db/schema/tables/itemLink";
import { itemCitationMetric } from "../src/db/schema/tables/itemCitationMetric";
import {
	publicationSyncJob,
	publicationTarget,
} from "../src/db/schema/publication";
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
import { removeNativeItem } from "../src/lib/admin/native-item-service";
import { citationCountForItem } from "../src/app/[locale]/statistics/queries/citation-measure";
import {
	getAuthorCountries,
	getDetailedAuthorStats,
} from "../src/app/[locale]/statistics/queries/author-stats";
import { getCitationsByYear } from "../src/app/[locale]/statistics/queries/basic-stats";
import { getCitationStats } from "../src/app/[locale]/statistics/queries/citation-stats";
import {
	getInstitutionStats,
	getInstitutionStatsByYear,
} from "../src/app/[locale]/statistics/queries/institution-stats";
import {
	getTopicStats,
	getTopicStatsByYear,
} from "../src/app/[locale]/statistics/queries/topic-stats";
import { getSourceCitationMetrics } from "../src/lib/links/citation-metrics";
import { generateSearchProjectionPlans } from "../src/lib/search-index/projection";
import {
	SourceAliasConflictError,
	SourceCursorConflictError,
	SourceFileStagingConflictError,
	SourceReferenceNotFoundError,
	SourceRelationshipCycleError,
	writeSourceIngestionBatch,
} from "../src/lib/source-ingestion/transactional-writer";
import { flushSourceFileCleanup } from "../src/lib/source-ingestion/zotero/attachment-processor";

const publicationConfig = libraryConfigSchema.parse(maximalLibraryConfig).services.publication;

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;

const connectionKeys = [
	"mendeley-writer",
	"zotero-writer",
	"zotero-unpublish-writer",
	"zotero-staging-writer",
	"zotero-native-link-writer",
	"zotero-native-file-writer",
	"zotero-links-writer",
	"openalex-citations-writer",
];
const tagNames = [
	"attachment-tag",
	"parent-tag",
	"writer-native-publish",
	"writer-native-remote",
	"restored-tag",
];
const nativeLinkItemKey = "NATV2345";
const nativeFileParentKey = "NATP2345";
const nativeFileItemKey = "NATA2345";

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
			{
				key: "zotero-native-file-writer",
				provider: "zotero",
				scopeKind: "group",
				externalScopeKey: "writer-zotero-native-file",
			},
			{
				key: "zotero-links-writer",
				provider: "zotero",
				scopeKind: "group",
				externalScopeKey: "999",
			},
			{
				key: "openalex-citations-writer",
				provider: "openalex",
				scopeKind: "query",
				config: { query: "education" },
			},
		]);

		await db.insert(itemIdentity).values(
			[nativeLinkItemKey, nativeFileParentKey, nativeFileItemKey].map(
				(key) => ({
					key,
					sourceConnectionKey: "native",
					sourceRecordKey: key,
				}),
			),
		);
		await db.insert(item).values([
			{
				key: nativeLinkItemKey,
				itemType: "Report",
				sourceConnectionKey: "native",
				sourceRecordKey: nativeLinkItemKey,
				title: "Local title",
				languageName: "French",
			},
			{
				key: nativeFileParentKey,
				itemType: "Report",
				sourceConnectionKey: "native",
				sourceRecordKey: nativeFileParentKey,
				title: "Native file parent",
			},
			{
				PDFCoverPageHeight: 1600,
				PDFCoverPageImage:
					"https://storage.example.org/native/cover.png",
				PDFCoverPageWidth: 1200,
				charset: "utf-8",
				contentType: "application/pdf",
				filename: "native.pdf",
				fullTextPDF: "Native extracted text",
				itemType: "Attachment",
				key: nativeFileItemKey,
				linkMode: "imported_file",
				md5: "native-md5",
				mtime: "1786042000000",
				parentItem: nativeFileParentKey,
				revision: 4,
				sourceConnectionKey: "native",
				sourceRecordKey: nativeFileItemKey,
				title: "Native attachment",
				url: "https://storage.example.org/native/document.pdf",
			},
		]);
		await db.insert(itemSourceLink).values([
			{
				dirtyFields: ["title", "languageName"],
				itemKey: nativeLinkItemKey,
				sourceConnectionKey: "zotero-native-link-writer",
				sourceRecordKey: "LINK2345",
				writebackEnabled: true,
			},
			{
				itemKey: nativeFileParentKey,
				sourceConnectionKey: "zotero-native-file-writer",
				sourceRecordKey: "FILEP001",
				writebackEnabled: true,
			},
			{
				itemKey: nativeFileItemKey,
				sourceConnectionKey: "zotero-native-file-writer",
				sourceRecordKey: "FILEA001",
				writebackEnabled: true,
			},
		]);
		await db
			.insert(tag)
			.values([
				{ name: "writer-native-publish" },
				{ name: "writer-native-remote" },
			])
			.onConflictDoNothing();
		await db.insert(itemToTag).values({
			itemKey: nativeFileItemKey,
			tagName: "writer-native-publish",
		});
		await db.insert(itemFilePublication).values({
			contentType: "application/pdf",
			coverHeight: 1600,
			coverObjectPath: "native/public/cover.png",
			coverPublicUrl: "https://storage.example.org/native/cover.png",
			coverWidth: 1200,
			filename: "native.pdf",
			itemKey: nativeFileItemKey,
			objectPath: "native/public/document.pdf",
			pageCount: 3,
			parentItemKey: nativeFileParentKey,
			publicationTags: ["writer-native-publish"],
			publicUrl: "https://storage.example.org/native/document.pdf",
			publishedAt: new Date("2026-08-06T12:00:00.000Z"),
			revision: 4,
			sha256: "d".repeat(64),
			md5: "e".repeat(32),
			sizeBytes: 200,
			sourceConnectionKey: "native",
			sourceCoverObjectPath: "native/private/cover.png",
			sourceObjectPath: "native/private/document.pdf",
			uploadRevision: 1,
		});

		const foreignFileUpdate = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-native-file-writer",
				expectedCursor: {},
				nextCursor: { version: 1 },
			}),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "FILEA001",
					remoteVersion: "2",
					raw: { key: "FILEA001", version: 2 },
					metadata: {
						itemType: "Attachment",
						tags: ["writer-native-remote"],
						title: "Remote attachment title",
					},
					file: {
						charset: null,
						contentType: "application/pdf",
						coverHeight: null,
						coverUrl: null,
						coverWidth: null,
						filename: "remote.pdf",
						fullText: null,
						linkMode: "linked_url",
						managedPublication: null,
						md5: null,
						mtime: null,
						url: "https://remote.example.org/document.pdf",
					},
				},
			],
		});
		const [
			[nativeFileAfterSync],
			[nativePublicationAfterSync],
			nativeFileTagsAfterSync,
			foreignFileCleanup,
		] = await Promise.all([
			db.select().from(item).where(eq(item.key, nativeFileItemKey)),
			db
				.select()
				.from(itemFilePublication)
				.where(eq(itemFilePublication.itemKey, nativeFileItemKey)),
			db
				.select({ name: itemToTag.tagName })
				.from(itemToTag)
				.where(eq(itemToTag.itemKey, nativeFileItemKey)),
			db
				.select()
				.from(sourceFileCleanup)
				.where(
					eq(
						sourceFileCleanup.sourceConnectionKey,
						"zotero-native-file-writer",
					),
				),
		]);
		assert(
			foreignFileUpdate.itemKeys.FILEA001 === nativeFileItemKey &&
				nativeFileAfterSync?.sourceConnectionKey === "native" &&
				nativeFileAfterSync.revision === 5 &&
				nativeFileAfterSync.title === "Remote attachment title" &&
				nativeFileAfterSync.parentItem === nativeFileParentKey &&
				nativeFileAfterSync.url ===
					"https://storage.example.org/native/document.pdf" &&
				nativeFileAfterSync.filename === "native.pdf" &&
				nativeFileAfterSync.linkMode === "imported_file" &&
				nativeFileAfterSync.md5 === "native-md5" &&
				nativeFileAfterSync.fullTextPDF === "Native extracted text" &&
				nativeFileAfterSync.PDFCoverPageImage ===
					"https://storage.example.org/native/cover.png" &&
				nativePublicationAfterSync?.sourceConnectionKey === "native" &&
				nativePublicationAfterSync.parentItemKey ===
					nativeFileParentKey &&
				nativePublicationAfterSync.revision === 4 &&
				nativePublicationAfterSync.objectPath ===
					"native/public/document.pdf" &&
				nativeFileTagsAfterSync.some(
					({ name }) => name === "writer-native-publish",
				) &&
				nativeFileTagsAfterSync.some(
					({ name }) => name === "writer-native-remote",
				) &&
				foreignFileCleanup.length === 0,
			"Inbound source sync overwrote or deleted foreign-owned PDF state",
		);

		const foreignStagedPaths = [
			"sources/zotero/native-foreign/document.pdf",
			"sources/zotero/native-foreign/cover.png",
		];
		const sourceOwnedStagedPaths = [
			"sources/zotero/native-sibling/document.pdf",
			"sources/zotero/native-sibling/cover.png",
		];
		await db.insert(sourceFileCleanup).values(
			[...foreignStagedPaths, ...sourceOwnedStagedPaths].map(
				(objectPath) => ({
					objectPath,
					sourceConnectionKey: "zotero-native-file-writer",
				}),
			),
		);
		await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-native-file-writer",
				expectedCursor: { version: 1 },
				nextCursor: { version: 2 },
			}),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "FILEA001",
					remoteVersion: "3",
					raw: { key: "FILEA001", version: 3 },
					metadata: {
						itemType: "Attachment",
						title: "Foreign staged attachment",
					},
					file: {
						charset: null,
						contentType: "application/pdf",
						coverHeight: 600,
						coverUrl:
							"https://remote.example.org/foreign-cover.png",
						coverWidth: 400,
						filename: "foreign.pdf",
						fullText: "Foreign remote PDF",
						linkMode: "imported_file",
						managedPublication: {
							coverObjectPath: foreignStagedPaths[1]!,
							objectPath: foreignStagedPaths[0]!,
							pageCount: 1,
							sha256: "e".repeat(64),
							sizeBytes: 100,
							staged: true,
						},
						md5: "e".repeat(32),
						mtime: "2",
						url: "https://remote.example.org/foreign.pdf",
					},
				},
				{
					operation: "upsert",
					sourceRecordKey: "FILES002",
					remoteVersion: "1",
					raw: { key: "FILES002", version: 1 },
					metadata: {
						itemType: "Attachment",
						title: "Source-owned staged attachment",
					},
					parentSourceRecordKey: "FILEP002",
					file: {
						charset: null,
						contentType: "application/pdf",
						coverHeight: 600,
						coverUrl:
							"https://storage.example.org/sibling-cover.png",
						coverWidth: 400,
						filename: "sibling.pdf",
						fullText: "Source-owned PDF",
						linkMode: "imported_file",
						managedPublication: {
							coverObjectPath: sourceOwnedStagedPaths[1]!,
							objectPath: sourceOwnedStagedPaths[0]!,
							pageCount: 1,
							sha256: "f".repeat(64),
							sizeBytes: 100,
							staged: true,
						},
						md5: "f".repeat(32),
						mtime: "2",
						url: "https://storage.example.org/sibling.pdf",
					},
				},
				{
					operation: "upsert",
					sourceRecordKey: "FILEP002",
					remoteVersion: "1",
					raw: { key: "FILEP002", version: 1 },
					metadata: {
						itemType: "Report",
						title: "Source-owned staged parent",
					},
				},
			],
		});
		const stagedCleanupAfterMixedBatch = await db
			.select({ objectPath: sourceFileCleanup.objectPath })
			.from(sourceFileCleanup)
			.where(
				eq(
					sourceFileCleanup.sourceConnectionKey,
					"zotero-native-file-writer",
				),
			);
		assert(
			foreignStagedPaths.every((objectPath) =>
				stagedCleanupAfterMixedBatch.some(
					(row) => row.objectPath === objectPath,
				),
			) &&
				sourceOwnedStagedPaths.every(
					(objectPath) =>
						!stagedCleanupAfterMixedBatch.some(
							(row) => row.objectPath === objectPath,
						),
				),
			"A foreign-owned staged file blocked or consumed the mixed source batch",
		);

		const linkedRecord = {
			operation: "upsert" as const,
			sourceRecordKey: "LINK2345",
			remoteVersion: "1",
			raw: { key: "LINK2345", version: 1 },
			metadata: {
				abstractNote: "Remote abstract",
				itemType: "Report",
				title: "Remote title",
				languageName: "English",
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
				linkedAfterFirst.languageName === "French" &&
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
				linkedSourceLink.lastAcknowledgedRemoteVersion === null &&
				linkedSnapshot?.remoteVersion === "4",
			"Link-scoped snapshots or dirty-field masking were not maintained",
		);

		const linkedRemoteDelete = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-native-link-writer",
				expectedCursor: { version: 4 },
				nextCursor: { version: 5 },
			}),
			items: [
				{
					operation: "delete",
					raw: { deleted: true, key: "LINK2345" },
					remoteVersion: "5",
					sourceRecordKey: "LINK2345",
				},
			],
		});
		const [[linkedAfterDelete], [linkAfterDelete]] = await Promise.all([
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
		]);
		assert(
			linkedRemoteDelete.written.items === 0 &&
				linkedRemoteDelete.written.outboxEvents === 0 &&
				linkedAfterDelete?.deleted === 0 &&
				linkedAfterDelete.revision === 3 &&
				linkAfterDelete?.remoteDeleted === true &&
				linkAfterDelete.remoteVersion === "5" &&
				linkAfterDelete.lastAcknowledgedRemoteVersion === null,
			"A remote deletion tombstoned a differently owned canonical item",
		);

		const linkedRemoteRestore = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-native-link-writer",
				expectedCursor: { version: 5 },
				nextCursor: { version: 6 },
			}),
			items: [
				{
					...linkedRecord,
					remoteVersion: "6",
					raw: { key: "LINK2345", version: 6 },
					metadata: {
						...linkedRecord.metadata,
						abstractNote: "Updated remote abstract",
					},
				},
			],
		});
		const [linkAfterRestore] = await db
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
			);
		assert(
			linkedRemoteRestore.written.items === 0 &&
				linkedRemoteRestore.written.outboxEvents === 0 &&
				linkAfterRestore?.remoteDeleted === false &&
				linkAfterRestore.remoteVersion === "6",
			"Restoring a linked remote record did not reactivate its source link",
		);

		const locallyRemoved = await removeNativeItem(db, nativeLinkItemKey);
		assert(
			locallyRemoved.item?.deleted === 1,
			"Native removal did not tombstone the linked item",
		);
		const linkedRemoteUpsertAfterLocalDelete =
			await writeSourceIngestionBatch(db, {
				...baseBatch({
					connectionKey: "zotero-native-link-writer",
					expectedCursor: { version: 6 },
					nextCursor: { version: 7 },
				}),
				items: [
					{
						...linkedRecord,
						remoteVersion: "7",
						raw: { key: "LINK2345", version: 7 },
					},
				],
			});
		const [[linkedAfterLocalDelete], [linkAfterLocalDeleteUpsert]] =
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
			]);
		assert(
			linkedRemoteUpsertAfterLocalDelete.written.items === 0 &&
				linkedRemoteUpsertAfterLocalDelete.written.outboxEvents === 0 &&
				linkedAfterLocalDelete?.deleted === 1 &&
				linkedAfterLocalDelete.revision ===
					locallyRemoved.item.revision &&
				linkAfterLocalDeleteUpsert?.remoteDeleted === false &&
				linkAfterLocalDeleteUpsert.remoteVersion === "7",
			"A remote upsert resurrected a locally deleted linked item",
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
					remoteVersion: "20",
					raw: { key: "CCCC2345", version: 20 },
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
					remoteVersion: "21",
					raw: { key: "DDDD2345", version: 21 },
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
						md5: "a".repeat(32),
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

		const [
			parent,
			attachment,
			childCollection,
			childCollectionLink,
			childCollectionSnapshot,
		] = await Promise.all([
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
			db
				.select()
				.from(collectionSourceLink)
				.where(
					and(
						eq(
							collectionSourceLink.collectionKey,
							first.collectionKeys.DDDD2345!,
						),
						eq(
							collectionSourceLink.sourceConnectionKey,
							"zotero-writer",
						),
					),
				)
				.then((rows) => rows[0]),
			db
				.select()
				.from(collectionSourceSnapshot)
				.where(
					and(
						eq(
							collectionSourceSnapshot.collectionKey,
							first.collectionKeys.DDDD2345!,
						),
						eq(
							collectionSourceSnapshot.sourceConnectionKey,
							"zotero-writer",
						),
					),
				)
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
			childCollection?.parentCollection ===
				first.collectionKeys.CCCC2345 &&
				childCollectionLink?.writebackEnabled === true &&
				childCollectionLink.remoteVersion === "21" &&
				childCollectionLink.lastAcknowledgedRemoteVersion === "21" &&
				childCollectionSnapshot?.remoteVersion === "21" &&
				childCollectionSnapshot.payloadHash.length === 64,
			"Collection parenting, source links, versions, or snapshots were not written",
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
		await db
			.delete(collectionSourceLink)
			.where(
				and(
					eq(
						collectionSourceLink.collectionKey,
						first.collectionKeys.DDDD2345!,
					),
					eq(
						collectionSourceLink.sourceConnectionKey,
						"zotero-writer",
					),
				),
			);

		const replay = await writeSourceIngestionBatch(db, {
			...firstBatch,
			collections: firstBatch.collections.map((record, index) => ({
				...record,
				remoteVersion: String(22 + index),
				raw: {
					key: record.sourceRecordKey,
					version: 22 + index,
				},
			})),
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
		const [childLinkAfterVersionOnlySync] = await db
			.select()
			.from(collectionSourceLink)
			.where(
				and(
					eq(
						collectionSourceLink.collectionKey,
						first.collectionKeys.DDDD2345!,
					),
					eq(
						collectionSourceLink.sourceConnectionKey,
						"zotero-writer",
					),
				),
			);
		assert(
			childLinkAfterVersionOnlySync?.remoteVersion === "23" &&
				childLinkAfterVersionOnlySync.lastAcknowledgedRemoteVersion ===
					"23",
			"A collection version-only sync did not advance its source link",
		);

		await db
			.update(collection)
			.set({ name: "Local pending child name" })
			.where(eq(collection.key, first.collectionKeys.DDDD2345!));
		await db
			.update(collectionSourceLink)
			.set({ dirtyFields: ["name"] })
			.where(
				and(
					eq(
						collectionSourceLink.collectionKey,
						first.collectionKeys.DDDD2345!,
					),
					eq(
						collectionSourceLink.sourceConnectionKey,
						"zotero-writer",
					),
				),
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
					collections: [{ sourceRecordKey: "DDDD2345" }],
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
			collections: [
				{
					...firstBatch.collections[1],
					remoteVersion: "24",
					raw: { key: "DDDD2345", version: 24 },
					data: {
						...firstBatch.collections[1]!.data,
						name: "Remote conflicting child name",
					},
				},
			],
		});
		assert(
			attachmentUpdate.written.items === 2,
			"Attachment update did not reproject its parent",
		);
		const [[childAfterDirtySync], [childLinkAfterDirtySync]] =
			await Promise.all([
				db
					.select()
					.from(collection)
					.where(eq(collection.key, first.collectionKeys.DDDD2345!)),
				db
					.select()
					.from(collectionSourceLink)
					.where(
						and(
							eq(
								collectionSourceLink.collectionKey,
								first.collectionKeys.DDDD2345!,
							),
							eq(
								collectionSourceLink.sourceConnectionKey,
								"zotero-writer",
							),
						),
					),
			]);
		assert(
			attachmentUpdate.written.collections === 0 &&
				childAfterDirtySync?.name === "Local pending child name" &&
				childLinkAfterDirtySync?.remoteVersion === "24" &&
				childLinkAfterDirtySync.lastAcknowledgedRemoteVersion === "23",
			"Inbound collection sync overwrote or acknowledged a dirty field",
		);
		const [[savedIssue], membershipsAfterSourceUpdate] = await Promise.all([
			db
				.select()
				.from(sourceRecordIssue)
				.where(
					and(
						eq(
							sourceRecordIssue.sourceConnectionKey,
							"zotero-writer",
						),
						eq(sourceRecordIssue.sourceRecordKey, "BBBB2345"),
					),
				),
			db
				.select()
				.from(itemToCollection)
				.where(eq(itemToCollection.itemKey, attachmentKey)),
		]);
		assert(
			savedIssue?.code === "zotero_file_unavailable",
			"A source record processing issue was not persisted with the batch",
		);
		assert(
			membershipsAfterSourceUpdate.length === 2,
			"A source update removed a collection membership owned by another source",
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
			collections: [
				{
					operation: "delete",
					sourceRecordKey: "DDDD2345",
					remoteVersion: "25",
					raw: { deleted: true, key: "DDDD2345" },
				},
			],
		});
		assert(
			deletion.written.items === 2,
			"Attachment deletion did not reproject its parent",
		);
		const [[childAfterDelete], [childLinkAfterDelete]] = await Promise.all([
			db
				.select()
				.from(collection)
				.where(eq(collection.key, first.collectionKeys.DDDD2345!)),
			db
				.select()
				.from(collectionSourceLink)
				.where(
					and(
						eq(
							collectionSourceLink.collectionKey,
							first.collectionKeys.DDDD2345!,
						),
						eq(
							collectionSourceLink.sourceConnectionKey,
							"zotero-writer",
						),
					),
				),
		]);
		assert(
			childAfterDelete?.deleted === 1 &&
				childLinkAfterDelete?.remoteDeleted === true &&
				childLinkAfterDelete.remoteVersion === "25" &&
				childLinkAfterDelete.lastAcknowledgedRemoteVersion === "23",
			"Collection deletion state or dirty acknowledgement was lost",
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
			collections: [
				{
					...firstBatch.collections[1],
					remoteVersion: "26",
					raw: { key: "DDDD2345", version: 26 },
				},
			],
		});
		const [restoredPublication, staleCleanup, [restoredCollection]] =
			await Promise.all([
				db
					.select()
					.from(itemFilePublication)
					.where(eq(itemFilePublication.itemKey, attachmentKey)),
				db
					.select()
					.from(sourceFileCleanup)
					.where(
						eq(
							sourceFileCleanup.sourceConnectionKey,
							"zotero-writer",
						),
					),
				db
					.select()
					.from(collection)
					.where(eq(collection.key, first.collectionKeys.DDDD2345!)),
			]);
		assert(
			restoredPublication.length === 1 &&
				staleCleanup.length === 0 &&
				restoredCollection?.deleted === 0,
			"Restoring source records left an unsafe cleanup or deleted collection",
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
						md5: "c".repeat(32),
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
		const publicationParentKey = publicationLifecycle.itemKeys.PUBP0001!;
		await db.insert(publicationTarget).values([
			{
				itemKey: publicationParentKey,
				provider: "crossref",
				environment: "test",
				identifierPolicy: null,
				requestedBy: "source-writer-verifier",
				activatedAt: new Date(),
			},
			{
				itemKey: publicationParentKey,
				provider: "zenodo",
				environment: "sandbox",
				identifierPolicy: "mint-zenodo",
				requestedBy: "source-writer-verifier",
				activatedAt: new Date(),
			},
		]);
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
						md5: "c".repeat(32),
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
		const jobsAfterSourceFileRemoval = await db
			.select()
			.from(publicationSyncJob)
			.where(
				and(
					eq(publicationSyncJob.itemKey, publicationParentKey),
					isNull(publicationSyncJob.supersededAt),
				),
			);
		assert(
			jobsAfterSourceFileRemoval.length === 2 &&
				jobsAfterSourceFileRemoval.every(job => job.reason === "file_changed") &&
				jobsAfterSourceFileRemoval.some(job => job.provider === "crossref") &&
				jobsAfterSourceFileRemoval.some(job => job.provider === "zenodo"),
			"A source PDF removal did not queue the active publication targets correctly",
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
						md5: "c".repeat(32),
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
		const jobsAfterSourceFilePublish = await db
			.select()
			.from(publicationSyncJob)
			.where(
				and(
					eq(publicationSyncJob.itemKey, publicationParentKey),
					isNull(publicationSyncJob.supersededAt),
				),
			);
		assert(
			jobsAfterSourceFilePublish.length === 2 &&
				jobsAfterSourceFilePublish.every(
					(job) => job.reason === "file_changed",
				) &&
				jobsAfterSourceFilePublish.some(
					(job) => job.provider === "crossref",
				) &&
				jobsAfterSourceFilePublish.some(
					(job) => job.provider === "zenodo",
				),
			"A source PDF publish did not queue both active publication targets",
		);
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

		await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-unpublish-writer",
				expectedCursor: { version: 4 },
				nextCursor: { version: 5 },
			}),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "PUBP0001",
					remoteVersion: "5",
					raw: { key: "PUBP0001", title: "Updated publication" },
					metadata: {
						itemType: "Report",
						title: "Updated publication parent",
					},
				},
			],
		});
		const currentPublicationJobs = await db
			.select()
			.from(publicationSyncJob)
			.where(
				and(
					eq(publicationSyncJob.itemKey, publicationParentKey),
					isNull(publicationSyncJob.supersededAt),
				),
			);
		assert(
			currentPublicationJobs.length === 2 &&
				currentPublicationJobs.every(job => job.reason === "record_changed") &&
				currentPublicationJobs.some(job => job.provider === "crossref") &&
				currentPublicationJobs.some(job => job.provider === "zenodo"),
			"A source metadata update did not replace stale publication jobs",
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
		// Zotero "related" links are mirrored into itemLink for the ingesting source only.
		const relatedUri = (key: string) =>
			`http://zotero.org/groups/999/items/${key}`;
		const linksBatchOne = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-links-writer",
				expectedCursor: {},
				nextCursor: { version: 1 },
			}),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "RELA2345",
					remoteVersion: "1",
					raw: { key: "RELA2345", version: 1 },
					metadata: {
						itemType: "Book",
						title: "Related one",
						relations: {
							"dc:relation": [
								relatedUri("RELB2345"),
								relatedUri("MISSNG23"),
								relatedUri("RELA2345"),
								// Same key, another library: must stay unresolved.
								"http://zotero.org/groups/998/items/RELB2345",
							],
						},
					},
				},
				{
					operation: "upsert",
					sourceRecordKey: "RELB2345",
					remoteVersion: "1",
					raw: { key: "RELB2345", version: 1 },
					metadata: {
						itemType: "Book",
						title: "Related two",
						relations: { "dc:relation": relatedUri("RELA2345") },
					},
				},
			],
		});
		const relaKey = linksBatchOne.itemKeys.RELA2345!;
		const relbKey = linksBatchOne.itemKeys.RELB2345!;
		const linksAfterOne = await db
			.select()
			.from(itemLink)
			.where(inArray(itemLink.fromKey, [relaKey, relbKey]))
			.orderBy(itemLink.fromKey);
		assert(
			linksAfterOne.length === 2 &&
				linksAfterOne.every(
					(row) =>
						row.kind === "related" &&
						row.origin === "source:zotero-links-writer",
				) &&
				linksAfterOne[0]!.toKey === relbKey &&
				linksAfterOne[1]!.toKey === relaKey,
			`Zotero related links were not mirrored: ${JSON.stringify(linksAfterOne)}`,
		);
		assert(
			linksBatchOne.written.unresolvedRelations === 2,
			`Unresolved and foreign-library relations must be counted (got ${String(linksBatchOne.written.unresolvedRelations)})`,
		);
		await db.insert(itemLink).values({
			fromKey: relaKey,
			toKey: relbKey,
			kind: "cites",
			origin: "manual",
		});
		const linksBatchTwo = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "zotero-links-writer",
				expectedCursor: { version: 1 },
				nextCursor: { version: 2 },
			}),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "RELA2345",
					remoteVersion: "2",
					raw: { key: "RELA2345", version: 2 },
					metadata: {
						itemType: "Book",
						title: "Related one",
						relations: {},
					},
				},
			],
		});
		const relbAfterRemoval = await db
			.select({ revision: item.revision })
			.from(item)
			.where(eq(item.key, relbKey))
			.then((rows) => rows[0]!);
		const linksAfterTwo = await db
			.select()
			.from(itemLink)
			.where(inArray(itemLink.fromKey, [relaKey, relbKey]))
			.orderBy(itemLink.fromKey, itemLink.kind);
		assert(
			linksBatchTwo.written.unresolvedRelations === 0 &&
				linksAfterTwo.length === 2 &&
				linksAfterTwo.some(
					(row) =>
						row.fromKey === relaKey &&
						row.kind === "cites" &&
						row.origin === "manual",
				) &&
				linksAfterTwo.some(
					(row) =>
						row.fromKey === relbKey &&
						row.kind === "related" &&
						row.origin === "source:zotero-links-writer",
				),
			`Resync must drop the source's stale related row and keep manual rows: ${JSON.stringify(linksAfterTwo)}`,
		);
		const relbOutbox = await db
			.select({ revision: outbox.revision })
			.from(outbox)
			.where(eq(outbox.entityKey, relbKey))
			.orderBy(outbox.id);
		assert(
			relbOutbox.length >= 2 &&
				relbOutbox.at(-1)!.revision === relbAfterRemoval.revision &&
				linksBatchTwo.written.outboxEvents >= 2,
			`Removing a source link must reindex the other record: ${JSON.stringify({ outbox: relbOutbox, revisionAfter: relbAfterRemoval.revision, written: linksBatchTwo.written })}`,
		);

		const openAlexBatchOne = await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "openalex-citations-writer",
				expectedCursor: {},
				nextCursor: { page: 2 },
			}),
			collections: [
				{
					operation: "upsert",
					sourceRecordKey: "CITATION_TOPIC",
					data: { name: "Citation research" },
				},
			],
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "W100000001",
					remoteVersion: "2026-07-29",
					raw: {
						id: "https://openalex.org/W100000001",
						cited_by_count: 17,
						referenced_works: [
							"https://openalex.org/W100000002",
							"https://openalex.org/W999999999",
						],
					},
					metadata: {
						date: "2026-07-29",
						itemType: "JournalArticle",
						title: "Citing work",
					},
					citationMetric: {
						citedByCount: 17,
						referencedWorksCount: 2,
					},
					collections: [{ sourceRecordKey: "CITATION_TOPIC" }],
					referencedSourceRecordKeys: ["W100000002", "W999999999"],
				},
				{
					operation: "upsert",
					sourceRecordKey: "W100000002",
					remoteVersion: "2026-07-29",
					raw: {
						id: "https://openalex.org/W100000002",
						cited_by_count: 4,
					},
					metadata: {
						date: "2026-07-29",
						itemType: "JournalArticle",
						title: "Cited work",
					},
					citationMetric: {
						citedByCount: 4,
						referencedWorksCount: 0,
					},
					collections: [{ sourceRecordKey: "CITATION_TOPIC" }],
				},
			],
		});
		const openAlexA = openAlexBatchOne.itemKeys.W100000001!;
		const openAlexB = openAlexBatchOne.itemKeys.W100000002!;
		await db
			.update(item)
			.set({
				creators: [
					{
						creatorType: "author",
						firstName: "Citation",
						lastName: "Researcher",
						institutions: [
							{
								country_code: "GB",
								display_name: "Citation Institute",
							},
						],
					},
				],
			})
			.where(inArray(item.key, [openAlexA, openAlexB]));
		const [
			openAlexMetrics,
			openAlexLinks,
			openAlexSnapshot,
			openAlexPublicMetrics,
			openAlexLibraryCount,
		] = await Promise.all([
			db
				.select()
				.from(itemCitationMetric)
				.where(
					eq(
						itemCitationMetric.sourceConnectionKey,
						"openalex-citations-writer",
					),
				)
				.orderBy(itemCitationMetric.itemKey),
			db
				.select()
				.from(itemLink)
				.where(eq(itemLink.origin, "source:openalex-citations-writer")),
			db
				.select({ payload: sourceSnapshot.payload })
				.from(sourceSnapshot)
				.where(
					and(
						eq(sourceSnapshot.itemKey, openAlexA),
						eq(
							sourceSnapshot.sourceConnectionKey,
							"openalex-citations-writer",
						),
					),
				)
				.then((rows) => rows[0]),
			getSourceCitationMetrics(db, openAlexA),
			db
				.select({
					count: citationCountForItem({
						kind: "library",
						key: "library",
					}),
				})
				.from(item)
				.where(eq(item.key, openAlexB))
				.then((rows) => rows[0]?.count),
		]);
		assert(
			openAlexMetrics.length === 2 &&
				openAlexMetrics.some(
					(row) =>
						row.itemKey === openAlexA &&
						row.citedByCount === 17 &&
						row.referencedWorksCount === 2,
				) &&
				openAlexLinks.length === 1 &&
				openAlexLinks[0]?.fromKey === openAlexA &&
				openAlexLinks[0]?.toKey === openAlexB &&
				openAlexLinks[0]?.kind === "cites" &&
				openAlexPublicMetrics[0]?.citedByCount === 17 &&
				Number(openAlexLibraryCount) === 1 &&
				openAlexBatchOne.written.unresolvedCitations === 1,
			`OpenAlex metrics and resolved citations were not stored separately: ${JSON.stringify({ metrics: openAlexMetrics, links: openAlexLinks, written: openAlexBatchOne.written })}`,
		);
		assert(
			Array.isArray(
				(openAlexSnapshot?.payload as { referenced_works?: unknown })
					?.referenced_works,
			),
			"Unresolved OpenAlex references must remain in the raw source snapshot",
		);
		const projectionPlans = [];
		for await (const plan of generateSearchProjectionPlans(db, publicationConfig, [
			{ entityKey: openAlexA, entityType: "item" },
			{ entityKey: openAlexB, entityType: "item" },
		])) {
			projectionPlans.push(plan);
		}
		const projectedOpenAlexA = projectionPlans
			.flatMap((plan) => plan.documents)
			.find((document) => document.key === openAlexA);
		assert(
			Array.isArray(projectedOpenAlexA?.citationMetrics) &&
				projectedOpenAlexA.citationMetrics.some(
					(metric) =>
						metric.sourceConnectionKey ===
							"openalex-citations-writer" &&
						metric.citedByCount === 17 &&
						metric.referencedWorksCount === 2,
				),
			`Search projection omitted source citation metrics: ${JSON.stringify(projectedOpenAlexA)}`,
		);

		const sourceCitationMeasure = {
			kind: "source" as const,
			key: "source:openalex-citations-writer",
			sourceConnectionKey: "openalex-citations-writer",
		};
		// Topics are the collections a library shows, named by title.
		const citationTopics = new Map([[openAlexBatchOne.collectionKeys.CITATION_TOPIC!, { title: "Citation topic" }]]);
		const [
			openAlexCitationStats,
			openAlexCitationsByYear,
			openAlexInstitutions,
			openAlexInstitutionsByYear,
			openAlexAuthorCountries,
			openAlexAuthors,
			openAlexTopics,
			openAlexTopicsByYear,
		] = await Promise.all([
			getCitationStats(db, sourceCitationMeasure),
			getCitationsByYear(db, sourceCitationMeasure),
			getInstitutionStats(db, sourceCitationMeasure),
			getInstitutionStatsByYear(db, sourceCitationMeasure),
			getAuthorCountries(db, sourceCitationMeasure),
			getDetailedAuthorStats(db, sourceCitationMeasure),
			getTopicStats(db, sourceCitationMeasure, citationTopics),
			getTopicStatsByYear(db, sourceCitationMeasure, citationTopics),
		]);
		assert(
			openAlexCitationStats.totalCitations === 21 &&
				openAlexCitationStats.maxCitations >= 17 &&
				openAlexCitationsByYear.some(
					(row) => row.year === "2026" && row.totalCitations === 21,
				) &&
				openAlexInstitutions.some(
					(row) =>
						row.institution === "Citation Institute" &&
						row.totalCitations === 21,
				) &&
				openAlexInstitutionsByYear.some(
					(row) =>
						row.institution === "Citation Institute" &&
						row.year === "2026" &&
						row.totalCitations === 21,
				) &&
				openAlexAuthorCountries.some(
					(row) => row.countryCode === "GB" && row.hIndex === 2,
				) &&
				openAlexAuthors.some(
					(row) =>
						row.authorName === "Citation Researcher" &&
						row.totalCitations === 21,
				) &&
				openAlexTopics.topicStats.some(
					(row) =>
						row.fullPath === "Citation topic" &&
						row.totalCitations === 21,
				) &&
				openAlexTopicsByYear.some(
					(row) =>
						row.fullPath === "Citation topic" &&
						row.year === "2026" &&
						row.totalCitations === 21,
				),
			`Source citation statistics did not use the selected metric: ${JSON.stringify({ citationStats: openAlexCitationStats, citationsByYear: openAlexCitationsByYear, institutions: openAlexInstitutions, institutionsByYear: openAlexInstitutionsByYear, authorCountries: openAlexAuthorCountries, authors: openAlexAuthors, topics: openAlexTopics, topicsByYear: openAlexTopicsByYear })}`,
		);

		const openAlexBeforeUpdate = await db
			.select({ key: item.key, revision: item.revision })
			.from(item)
			.where(inArray(item.key, [openAlexA, openAlexB]));
		await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "openalex-citations-writer",
				expectedCursor: { page: 2 },
				nextCursor: { page: 3 },
			}),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "W100000001",
					remoteVersion: "2026-07-30",
					raw: {
						id: "https://openalex.org/W100000001",
						cited_by_count: 18,
					},
					metadata: {
						itemType: "JournalArticle",
						title: "Citing work",
					},
					citationMetric: {
						citedByCount: 18,
						referencedWorksCount: 0,
					},
					referencedSourceRecordKeys: [],
				},
			],
		});
		const [updatedMetric] = await db
			.select()
			.from(itemCitationMetric)
			.where(
				and(
					eq(itemCitationMetric.itemKey, openAlexA),
					eq(
						itemCitationMetric.sourceConnectionKey,
						"openalex-citations-writer",
					),
				),
			);
		const openAlexAfterUpdate = await db
			.select({ key: item.key, revision: item.revision })
			.from(item)
			.where(inArray(item.key, [openAlexA, openAlexB]));
		const beforeRevision = new Map(
			openAlexBeforeUpdate.map((row) => [row.key, row.revision]),
		);
		assert(
			updatedMetric?.citedByCount === 18 &&
				(
					await db
						.select()
						.from(itemLink)
						.where(
							eq(
								itemLink.origin,
								"source:openalex-citations-writer",
							),
						)
				).length === 0 &&
				openAlexAfterUpdate.every(
					(row) => row.revision > (beforeRevision.get(row.key) ?? 0),
				),
			"Replacing source metrics and citations must update the metric, remove stale links, and reindex both records",
		);
		await writeSourceIngestionBatch(db, {
			...baseBatch({
				connectionKey: "openalex-citations-writer",
				expectedCursor: { page: 3 },
				nextCursor: { page: 4 },
			}),
			items: [
				{
					operation: "upsert",
					sourceRecordKey: "W100000001",
					remoteVersion: "2026-07-31",
					raw: { id: "https://openalex.org/W100000001" },
					metadata: {
						itemType: "JournalArticle",
						title: "Citing work",
					},
					citationMetric: null,
					referencedSourceRecordKeys: [],
				},
			],
		});
		const removedMetric = await db
			.select()
			.from(itemCitationMetric)
			.where(
				and(
					eq(itemCitationMetric.itemKey, openAlexA),
					eq(
						itemCitationMetric.sourceConnectionKey,
						"openalex-citations-writer",
					),
				),
			);
		assert(
			removedMetric.length === 0,
			"A source that stops reporting citation metrics must remove its stale metric row",
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
			nativeFileParentKey,
			nativeFileItemKey,
		];
		if (itemKeys.length > 0) {
			await db
				.delete(publicationSyncJob)
				.where(inArray(publicationSyncJob.itemKey, itemKeys));
			await db
				.delete(publicationTarget)
				.where(inArray(publicationTarget.itemKey, itemKeys));
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
			.where(
				inArray(itemIdentity.key, [
					nativeLinkItemKey,
					nativeFileParentKey,
					nativeFileItemKey,
				]),
			);
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
