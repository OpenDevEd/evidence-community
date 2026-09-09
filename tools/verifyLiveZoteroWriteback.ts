import { createHash } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
	itemDraft,
	itemFileDraft,
	itemIdentity,
	itemSourceLink,
	outbox,
	sourceConnection,
	sourceWritebackJob,
} from "@opendeved/evidence-library-core";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { loadLibraryConfig } from "../src/config/library-config/source";
import type { Database } from "../src/db/database-schema";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import { itemFilePublication, sourceSnapshot } from "../src/db/schema/source";
import { item } from "../src/db/schema/tables/item";
import { itemToCollection } from "../src/db/schema/tables/itemToCollection";
import { itemToTag } from "../src/db/schema/tables/itemToTag";
import { createSupabaseFileStorage } from "../src/lib/admin/file-storage";
import {
	completeNativePdfUpload,
	publishNativePdf,
	stageNativePdfUpload,
	unpublishNativePdf,
} from "../src/lib/admin/native-file-service";
import {
	createNativeItemDraft,
	openItemDraft,
	publishItemDraft,
	publishItemDraftWithContext,
	removeNativeItem,
	saveItemDraft,
} from "../src/lib/admin/native-item-service";
import { itemLink } from "../src/db/schema/tables/itemLink";
import { runSourceConnection } from "../src/lib/source-ingestion/orchestrator";
import { createSourceSyncRuntime } from "../src/lib/source-ingestion/runtime";
import {
	ZoteroApiError,
	type ZoteroApiClient,
} from "../src/lib/source-ingestion/zotero/client";
import { createZoteroConnectionClient } from "../src/lib/source-ingestion/zotero/connection";
import {
	drainSourceWritebackJobs,
	type SourceWritebackProcessResult,
} from "../src/lib/source-writeback/consumer";
import {
	getAdminSourceWritebackStatus,
	resolveAdminSourceWritebackConflict,
	setAdminItemWritebackSources,
} from "../src/lib/admin/source-writeback-service";
import { createSourceWritebackRuntime } from "../src/lib/source-writeback/runtime";
import {
	assertLiveZoteroConnection,
	assertLoopbackServiceUrl,
	LIVE_ZOTERO_CONNECTION_KEY,
	parseLiveVerifierCommand,
} from "./verifyLiveZoteroPipeline";
import { createFixturePdf, ZOTERO_PLAYGROUND } from "./seedZoteroPlayground";

const PDF_CONTENT_TYPE = "application/pdf";
const PDF_TOKEN = "OPENSCHOLAR-LIVE-WRITEBACK-PDF-001";
const MAX_DRAIN_PASSES = 6;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function sha256(bytes: Uint8Array) {
	return createHash("sha256").update(bytes).digest("hex");
}

function remoteTags(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value
		.flatMap((entry) => {
			if (!entry || typeof entry !== "object" || !("tag" in entry)) {
				return [];
			}
			return [String(entry.tag)];
		})
		.sort();
}

function assertSameSet(
	actual: readonly string[],
	expected: readonly string[],
	message: string,
) {
	assert(
		JSON.stringify([...new Set(actual)].sort()) ===
			JSON.stringify([...new Set(expected)].sort()),
		`${message}: expected ${JSON.stringify([...expected].sort())}, received ${JSON.stringify([...actual].sort())}`,
	);
}

async function actionableWritebackJobs(database: Database) {
	const [row] = await database
		.select({ count: sql<number>`count(*)::int` })
		.from(sourceWritebackJob)
		.where(
			and(
				isNull(sourceWritebackJob.processedAt),
				isNull(sourceWritebackJob.deadLetteredAt),
			),
		);
	return row?.count ?? 0;
}

async function drainWriteback(
	database: Database,
	config: Awaited<ReturnType<typeof loadLibraryConfig>>,
	itemKeys: readonly string[],
	label: string,
) {
	const runtime = createSourceWritebackRuntime(config);
	const results: SourceWritebackProcessResult[] = [];
	for (let pass = 0; pass < MAX_DRAIN_PASSES; pass += 1) {
		results.push(
			...(await drainSourceWritebackJobs(
				{
					credentialResolver: runtime.credentialResolver,
					database,
					heartbeatIntervalMs: 1_000,
					leaseDurationMs: 10_000,
					maxAttempts: 5,
					registry: runtime.registry,
					retryBaseMs: 100,
					retryMaxMs: 500,
					sourceWritebackEnabled: () => true,
					workerId: `zotero-live-writeback:${process.pid}:${label}`,
				},
				100,
			)),
		);
		const pending = await database
			.select({
				deadLetteredAt: sourceWritebackJob.deadLetteredAt,
				id: sourceWritebackJob.id,
				lastError: sourceWritebackJob.lastError,
				processedAt: sourceWritebackJob.processedAt,
			})
			.from(sourceWritebackJob)
			.where(
				and(
					inArray(sourceWritebackJob.itemKey, [...itemKeys]),
					isNull(sourceWritebackJob.processedAt),
				),
			);
		const failed = pending.find((job) => job.deadLetteredAt !== null);
		assert(
			!failed,
			`${label} dead-lettered writeback job ${failed?.id}: ${failed?.lastError}`,
		);
		if (pending.length === 0) {
			assert(
				results.every(
					(result) =>
						result.status !== "dead-lettered" &&
						result.status !== "lease-lost",
				),
				`${label} returned a terminal writeback failure`,
			);
			return results;
		}
		await delay(550);
	}
	throw new Error(`${label} left writeback jobs pending`);
}

async function remoteItem(
	client: ZoteroApiClient,
	prefix: string,
	itemKey: string,
) {
	return (await client.item(prefix, itemKey)).data;
}

async function remoteItemIsMissing(
	client: ZoteroApiClient,
	prefix: string,
	itemKey: string,
) {
	try {
		await client.item(prefix, itemKey);
		return false;
	} catch (error) {
		if (error instanceof ZoteroApiError && error.status === 404)
			return true;
		throw error;
	}
}

async function deleteRemoteIfPresent(
	client: ZoteroApiClient,
	prefix: string,
	itemKey: string,
) {
	try {
		const current = await client.item(prefix, itemKey);
		await client.deleteItem(prefix, itemKey, current.data.version);
	} catch (error) {
		if (error instanceof ZoteroApiError && error.status === 404) return;
		throw error;
	}
}

async function assertPrivateObjectMissing(
	storage: ReturnType<typeof createSupabaseFileStorage>,
	objectPath: string,
) {
	try {
		await storage.downloadPrivate(objectPath);
	} catch {
		return;
	}
	throw new Error(`Private storage object still exists: ${objectPath}`);
}

async function verifyNativeSeparation(
	database: Database,
	itemKeys: readonly string[],
) {
	const [canonicalItems, nativeIdentities, remoteIdentities, links] =
		await Promise.all([
			database
				.select({
					key: item.key,
					sourceConnectionKey: item.sourceConnectionKey,
				})
				.from(item)
				.where(inArray(item.key, [...itemKeys])),
			database
				.select({ key: itemIdentity.key })
				.from(itemIdentity)
				.where(
					and(
						inArray(itemIdentity.key, [...itemKeys]),
						eq(itemIdentity.sourceConnectionKey, "native"),
					),
				),
			database
				.select({ key: itemIdentity.key })
				.from(itemIdentity)
				.where(
					and(
						inArray(itemIdentity.key, [...itemKeys]),
						eq(
							itemIdentity.sourceConnectionKey,
							LIVE_ZOTERO_CONNECTION_KEY,
						),
					),
				),
			database
				.select()
				.from(itemSourceLink)
				.where(
					and(
						inArray(itemSourceLink.itemKey, [...itemKeys]),
						eq(
							itemSourceLink.sourceConnectionKey,
							LIVE_ZOTERO_CONNECTION_KEY,
						),
					),
				),
		]);
	assert(
		canonicalItems.length === itemKeys.length &&
			canonicalItems.every(
				(row) => row.sourceConnectionKey === "native",
			) &&
			nativeIdentities.length === itemKeys.length &&
			remoteIdentities.length === 0 &&
			links.length === itemKeys.length &&
			links.every(
				(link) =>
					link.writebackEnabled &&
					link.sourceRecordKey === link.itemKey,
			),
		"Native canonical ownership and Zotero source links are not separated",
	);
	return links;
}

async function cleanupLocalItems(database: Database, itemKeys: string[]) {
	if (itemKeys.length === 0) return;
	await database
		.delete(sourceWritebackJob)
		.where(inArray(sourceWritebackJob.itemKey, itemKeys));
	await database
		.delete(sourceSnapshot)
		.where(inArray(sourceSnapshot.itemKey, itemKeys));
	await database
		.delete(itemDraft)
		.where(inArray(itemDraft.itemKey, itemKeys));
	await database
		.delete(itemFileDraft)
		.where(inArray(itemFileDraft.itemKey, itemKeys));
	await database
		.delete(itemFilePublication)
		.where(inArray(itemFilePublication.itemKey, itemKeys));
	await database
		.delete(itemToCollection)
		.where(inArray(itemToCollection.itemKey, itemKeys));
	await database
		.delete(itemToTag)
		.where(inArray(itemToTag.itemKey, itemKeys));
	await database
		.delete(outbox)
		.where(
			and(
				eq(outbox.entityType, "item"),
				inArray(outbox.entityKey, itemKeys),
			),
		);
	await database.delete(item).where(inArray(item.key, itemKeys));
	await database
		.delete(itemSourceLink)
		.where(inArray(itemSourceLink.itemKey, itemKeys));
	await database
		.delete(itemIdentity)
		.where(inArray(itemIdentity.key, itemKeys));
}

async function verifyLiveWriteback() {
	parseLiveVerifierCommand(process.argv.slice(2));
	const config = await loadLibraryConfig();
	assertLoopbackServiceUrl("Database URL", config.services.database.url);
	assertLoopbackServiceUrl("Storage URL", config.services.storage.url);
	assertLoopbackServiceUrl("Search URL", config.services.search.host);

	const databaseResource = createPostgresDatabaseResource(
		config.services.database.url,
	);
	const database = databaseResource.database;
	const storage = createSupabaseFileStorage(config.services.storage);
	const itemKeys: string[] = [];
	const privatePaths = new Set<string>();
	const publicPaths = new Set<string>();
	let zoteroClient: ZoteroApiClient | null = null;
	let zoteroPrefix: string | null = null;
	let syncRuntime: ReturnType<typeof createSourceSyncRuntime> | null = null;

	try {
		assert(
			(await actionableWritebackJobs(database)) === 0,
			"The local database has pending writeback jobs; drain them before live verification",
		);
		const [connection] = await database
			.select()
			.from(sourceConnection)
			.where(eq(sourceConnection.key, LIVE_ZOTERO_CONNECTION_KEY))
			.limit(1);
		assertLiveZoteroConnection(connection);

		syncRuntime = createSourceSyncRuntime(config, database);
		const zotero = await createZoteroConnectionClient(connection, {
			credentialResolver: syncRuntime.credentialResolver,
		});
		await zotero.client.verifyKeyAccess(zotero.scope, "write");
		zoteroClient = zotero.client;
		zoteroPrefix = zotero.prefix;

		const publicationTags = config.content.tags.publish;
		assert(
			publicationTags.length > 0,
			"The active configuration needs at least one PDF publication tag",
		);
		assert(
			config.sources.some(
				(source) =>
					source.key === LIVE_ZOTERO_CONNECTION_KEY &&
					source.writebackEnabled,
			),
			"The active configuration must enable writeback for the live Zotero source",
		);

		const marker = `openscholar-live-writeback-${process.pid}-${Date.now()}`;
		const parentDraft = await createNativeItemDraft(database, {
			abstractNote: `Temporary Zotero writeback verifier ${marker}`,
			itemType: "Report",
			tags: [marker],
			title: `OpenScholar live writeback parent ${marker}`,
		});
		const attachmentDraft = await createNativeItemDraft(database, {
			itemType: "Attachment",
			parentItem: parentDraft.itemKey,
			tags: [marker],
			title: `OpenScholar live writeback PDF ${marker}`,
		});
		itemKeys.push(parentDraft.itemKey, attachmentDraft.itemKey);

		// The parent chooses the live Zotero source; the attachment copies it.
		await publishItemDraftWithContext(database, parentDraft.itemKey, {
			sourceKeys: [LIVE_ZOTERO_CONNECTION_KEY],
			writebackConfig: config,
		});
		await publishItemDraft(database, attachmentDraft.itemKey);
		const metadataWriteback = await drainWriteback(
			database,
			config,
			itemKeys,
			"metadata",
		);
		const [remoteParent, remoteAttachment] = await Promise.all([
			remoteItem(zotero.client, zotero.prefix, parentDraft.itemKey),
			remoteItem(zotero.client, zotero.prefix, attachmentDraft.itemKey),
		]);
		assert(
			remoteParent.data.itemType === "report" &&
				remoteParent.data.title ===
					`OpenScholar live writeback parent ${marker}`,
			"Parent metadata was not created in Zotero",
		);
		assert(
			remoteAttachment.data.itemType === "attachment" &&
				remoteAttachment.data.parentItem === parentDraft.itemKey &&
				remoteAttachment.data.linkMode === "linked_url" &&
				remoteAttachment.data.url === "",
			"Attachment metadata was not created separately from its PDF publication",
		);
		assertSameSet(
			remoteTags(remoteAttachment.data.tags),
			[marker],
			"Attachment metadata tags are incorrect",
		);
		await verifyNativeSeparation(database, itemKeys);

		const pdfBytes = new Uint8Array(
			await createFixturePdf({
				documentTitle: `OpenScholar live writeback ${marker}`,
				pageTokens: [PDF_TOKEN],
			}),
		);
		const staged = await stageNativePdfUpload(database, storage, {
			expectedSha256: sha256(pdfBytes),
			expectedSizeBytes: pdfBytes.byteLength,
			filename: "openscholar-live-writeback.pdf",
			itemKey: attachmentDraft.itemKey,
			maxPdfBytes: config.services.storage.maxPdfBytes,
		});
		privatePaths.add(staged.fileDraft.objectPath);
		await storage.uploadPrivate(
			staged.upload.path,
			pdfBytes,
			PDF_CONTENT_TYPE,
		);
		const ready = await completeNativePdfUpload(database, storage, {
			expectedUploadRevision: staged.fileDraft.uploadRevision,
			itemKey: attachmentDraft.itemKey,
			maxPdfBytes: config.services.storage.maxPdfBytes,
		});
		privatePaths.add(ready.objectPath);
		assert(ready.coverObjectPath, "PDF completion did not create a cover");
		privatePaths.add(ready.coverObjectPath);
		const published = await publishNativePdf(database, storage, config.services.publication, {
			expectedUploadRevision: ready.uploadRevision,
			itemKey: attachmentDraft.itemKey,
			publicationTags,
		});
		publicPaths.add(published.file.objectPath);
		publicPaths.add(published.file.coverObjectPath);
		await drainWriteback(database, config, itemKeys, "pdf-publish");

		const publishedRemote = await remoteItem(
			zotero.client,
			zotero.prefix,
			attachmentDraft.itemKey,
		);
		assert(
			publishedRemote.data.linkMode === "linked_url" &&
				publishedRemote.data.url === published.file.publicUrl &&
				published.file.sourceConnectionKey === "native" &&
				published.item.sourceConnectionKey === "native",
			"The published PDF URL or native ownership was not written to Zotero",
		);
		assertSameSet(
			remoteTags(publishedRemote.data.tags),
			[marker, ...publicationTags],
			"Published attachment tags are incorrect",
		);
		const publishedResponse = await fetch(
			`${published.file.publicUrl}?verify=${Date.now()}`,
			{ cache: "no-store" },
		);
		assert(
			publishedResponse.ok &&
				publishedResponse.headers
					.get("content-type")
					?.includes(PDF_CONTENT_TYPE),
			"The published PDF is not retrievable from local Supabase storage",
		);

		const remoteOnlyTag = `remote-only-${marker}`;
		const remoteTitle = `Remote Zotero edit ${marker}`;
		await zotero.client.patchItem(
			zotero.prefix,
			attachmentDraft.itemKey,
			{
				tags: [{ tag: marker }, { tag: remoteOnlyTag }],
				title: remoteTitle,
				url: "https://example.org/remote-file-override.pdf",
			},
			publishedRemote.version,
		);
		const inbound = await runSourceConnection({
			credentialResolver: syncRuntime.credentialResolver,
			database,
			registry: syncRuntime.registry,
			sourceConnectionKey: LIVE_ZOTERO_CONNECTION_KEY,
			workerId: `zotero-live-writeback-inbound:${process.pid}`,
		});

		const [
			[canonicalAfterInbound],
			[publicationAfterInbound],
			[linkAfterInbound],
			[snapshotAfterInbound],
			canonicalTagsAfterInbound,
		] = await Promise.all([
			database
				.select()
				.from(item)
				.where(eq(item.key, attachmentDraft.itemKey)),
			database
				.select()
				.from(itemFilePublication)
				.where(
					eq(itemFilePublication.itemKey, attachmentDraft.itemKey),
				),
			database
				.select()
				.from(itemSourceLink)
				.where(
					and(
						eq(itemSourceLink.itemKey, attachmentDraft.itemKey),
						eq(
							itemSourceLink.sourceConnectionKey,
							LIVE_ZOTERO_CONNECTION_KEY,
						),
					),
				),
			database
				.select()
				.from(sourceSnapshot)
				.where(
					and(
						eq(sourceSnapshot.itemKey, attachmentDraft.itemKey),
						eq(
							sourceSnapshot.sourceConnectionKey,
							LIVE_ZOTERO_CONNECTION_KEY,
						),
					),
				),
			database
				.select({ name: itemToTag.tagName })
				.from(itemToTag)
				.where(eq(itemToTag.itemKey, attachmentDraft.itemKey)),
		]);
		assert(
			canonicalAfterInbound?.title === remoteTitle &&
				canonicalAfterInbound.sourceConnectionKey === "native" &&
				canonicalAfterInbound.parentItem === parentDraft.itemKey &&
				canonicalAfterInbound.url === published.file.publicUrl &&
				canonicalAfterInbound.fullTextPDF?.includes(PDF_TOKEN) &&
				canonicalAfterInbound.PDFCoverPageImage ===
					published.file.coverPublicUrl &&
				publicationAfterInbound?.objectPath ===
					published.file.objectPath &&
				linkAfterInbound?.dirtyFields.length === 0 &&
				linkAfterInbound.remoteVersion ===
					snapshotAfterInbound?.remoteVersion,
			`Inbound Zotero edits overwrote native file state or failed to import metadata: ${JSON.stringify(
				{
					canonical: canonicalAfterInbound
						? {
								cover: canonicalAfterInbound.PDFCoverPageImage,
								fullTextHasToken:
									canonicalAfterInbound.fullTextPDF?.includes(
										PDF_TOKEN,
									),
								parentItem: canonicalAfterInbound.parentItem,
								sourceConnectionKey:
									canonicalAfterInbound.sourceConnectionKey,
								title: canonicalAfterInbound.title,
								url: canonicalAfterInbound.url,
							}
						: null,
					expected: {
						cover: published.file.coverPublicUrl,
						parentItem: parentDraft.itemKey,
						title: remoteTitle,
						url: published.file.publicUrl,
					},
					link: linkAfterInbound
						? {
								dirtyFields: linkAfterInbound.dirtyFields,
								remoteVersion: linkAfterInbound.remoteVersion,
							}
						: null,
					publicationObjectPath:
						publicationAfterInbound?.objectPath ?? null,
					snapshotRemoteVersion:
						snapshotAfterInbound?.remoteVersion ?? null,
				},
			)}`,
		);
		assertSameSet(
			canonicalTagsAfterInbound.map(({ name }) => name),
			[marker, remoteOnlyTag, ...publicationTags],
			"Inbound tag ownership did not preserve publication tags",
		);
		await verifyNativeSeparation(database, itemKeys);

		await unpublishNativePdf(database, storage, config.services.publication, attachmentDraft.itemKey);
		await drainWriteback(database, config, itemKeys, "pdf-unpublish");
		const unpublishedRemote = await remoteItem(
			zotero.client,
			zotero.prefix,
			attachmentDraft.itemKey,
		);
		const [[unpublishedCanonical], unpublishedLedger] = await Promise.all([
			database
				.select()
				.from(item)
				.where(eq(item.key, attachmentDraft.itemKey)),
			database
				.select()
				.from(itemFilePublication)
				.where(
					eq(itemFilePublication.itemKey, attachmentDraft.itemKey),
				),
		]);
		assert(
			unpublishedCanonical?.url === null &&
				unpublishedCanonical.fullTextPDF === null &&
				unpublishedLedger.length === 0 &&
				unpublishedRemote.data.linkMode === "linked_url" &&
				unpublishedRemote.data.url === "",
			"PDF unpublication did not clear local and remote publication state",
		);
		assertSameSet(
			remoteTags(unpublishedRemote.data.tags),
			[marker, remoteOnlyTag],
			"PDF unpublication did not remove only publication-owned tags",
		);
		await Promise.all(
			[...privatePaths].map((objectPath) =>
				assertPrivateObjectMissing(storage, objectPath),
			),
		);
		const removedPublicResponse = await fetch(
			`${published.file.publicUrl}?verify-removed=${Date.now()}`,
			{ cache: "no-store" },
		);
		assert(
			!removedPublicResponse.ok,
			"The unpublished PDF still exists in public storage",
		);

		// Pause the source, change the record in Zotero, turn the source back
		// on: the worker must stop in "conflict" and each choice must end in
		// the documented state on both sides.
		const [localBefore] = await database
			.select({ title: item.title })
			.from(item)
			.where(eq(item.key, parentDraft.itemKey));
		await setAdminItemWritebackSources(
			database,
			parentDraft.itemKey,
			[],
			config,
		);
		const pausedRemote = await zotero.client.item(
			zotero.prefix,
			parentDraft.itemKey,
		);
		await zotero.client.patchItem(
			zotero.prefix,
			parentDraft.itemKey,
			{ title: "Changed in Zotero while paused" },
			pausedRemote.data.version,
		);
		await setAdminItemWritebackSources(
			database,
			parentDraft.itemKey,
			[LIVE_ZOTERO_CONNECTION_KEY],
			config,
		);
		const conflictDrain = await drainWriteback(
			database,
			config,
			itemKeys,
			"conflict-check",
		);
		const conflictStatus = await getAdminSourceWritebackStatus(
			database,
			parentDraft.itemKey,
			LIVE_ZOTERO_CONNECTION_KEY,
			config,
		);
		assert(
			conflictDrain.some((result) => result.status === "conflict") &&
				conflictStatus.state === "conflict",
			"A Zotero change made while the source was paused was not detected as a conflict",
		);
		const conflictRuntime = createSourceWritebackRuntime(config);
		await resolveAdminSourceWritebackConflict(
			database,
			parentDraft.itemKey,
			LIVE_ZOTERO_CONNECTION_KEY,
			"send-local",
			config,
			conflictRuntime,
		);
		await drainWriteback(database, config, itemKeys, "conflict-send-local");
		const afterSendLocal = await zotero.client.item(
			zotero.prefix,
			parentDraft.itemKey,
		);
		assert(
			afterSendLocal.data.data.title === localBefore?.title,
			"Choosing to send this record did not overwrite the Zotero title",
		);

		await setAdminItemWritebackSources(
			database,
			parentDraft.itemKey,
			[],
			config,
		);
		await zotero.client.patchItem(
			zotero.prefix,
			parentDraft.itemKey,
			{ title: "Zotero wins this time" },
			afterSendLocal.data.version,
		);
		await setAdminItemWritebackSources(
			database,
			parentDraft.itemKey,
			[LIVE_ZOTERO_CONNECTION_KEY],
			config,
		);
		await drainWriteback(database, config, itemKeys, "conflict-check-2");
		const loadRemoteStatus = await resolveAdminSourceWritebackConflict(
			database,
			parentDraft.itemKey,
			LIVE_ZOTERO_CONNECTION_KEY,
			"load-remote",
			config,
			conflictRuntime,
		);
		const [localAfterLoad] = await database
			.select({ title: item.title })
			.from(item)
			.where(eq(item.key, parentDraft.itemKey));
		assert(
			loadRemoteStatus.status.state === "synced" &&
				localAfterLoad?.title === "Zotero wins this time",
			"Choosing to load Zotero's version did not replace the local record",
		);

		// Related links: a manual "related" link between two native records reaches Zotero
		// as dc:relation on both items, survives an unrelated owl:sameAs, comes back as a
		// source-owned row on the next sync, and disappears on both sides when removed.
		const relatedDraft = await createNativeItemDraft(database, {
			itemType: "Report",
			tags: [marker],
			title: `OpenScholar live writeback related ${marker}`,
		});
		itemKeys.push(relatedDraft.itemKey);
		await publishItemDraftWithContext(database, relatedDraft.itemKey, {
			sourceKeys: [LIVE_ZOTERO_CONNECTION_KEY],
			writebackConfig: config,
		});
		await drainWriteback(database, config, itemKeys, "related-create");
		const relatedUri = `http://zotero.org/groups/${ZOTERO_PLAYGROUND.groupId}/items/${relatedDraft.itemKey}`;
		const parentUri = `http://zotero.org/groups/${ZOTERO_PLAYGROUND.groupId}/items/${parentDraft.itemKey}`;
		const sameAsUri = `http://zotero.org/groups/${ZOTERO_PLAYGROUND.groupId}/items/${attachmentDraft.itemKey}`;
		const linkDraft = await openItemDraft(database, parentDraft.itemKey);
		await saveItemDraft(database, {
			itemKey: parentDraft.itemKey,
			expectedDraftGeneration: linkDraft.generation,
			expectedDraftRevision: linkDraft.draftRevision,
			expectedPayload: linkDraft.payload,
			payload: {
				...linkDraft.payload,
				links: { cites: [attachmentDraft.itemKey], related: [relatedDraft.itemKey] },
				relations: { "owl:sameAs": sameAsUri },
			},
		});
		await publishItemDraft(database, parentDraft.itemKey);
		await drainWriteback(database, config, itemKeys, "related-add");
		const [remoteParentLinked, remoteRelatedLinked] = await Promise.all([
			remoteItem(zotero.client, zotero.prefix, parentDraft.itemKey),
			remoteItem(zotero.client, zotero.prefix, relatedDraft.itemKey),
		]);
		const parentRelations = remoteParentLinked.data.relations as Record<string, unknown>;
		const relatedRelations = remoteRelatedLinked.data.relations as Record<string, unknown>;
		assert(
			parentRelations["dc:relation"] === relatedUri &&
				parentRelations["owl:sameAs"] === sameAsUri &&
				relatedRelations["dc:relation"] === parentUri,
			`Related link did not reach Zotero on both items: ${JSON.stringify({ parentRelations, relatedRelations })}`,
		);
		await runSourceConnection({
			credentialResolver: syncRuntime.credentialResolver,
			database,
			registry: syncRuntime.registry,
			sourceConnectionKey: LIVE_ZOTERO_CONNECTION_KEY,
			workerId: `zotero-live-writeback-related-inbound:${process.pid}`,
		});
		const linkRowsAfterSync = await database
			.select({ fromKey: itemLink.fromKey, origin: itemLink.origin, toKey: itemLink.toKey })
			.from(itemLink)
			.where(
				and(
					eq(itemLink.kind, "related"),
					inArray(itemLink.fromKey, [parentDraft.itemKey, relatedDraft.itemKey]),
				),
			);
		const sourceOrigin = `source:${LIVE_ZOTERO_CONNECTION_KEY}`;
		const hasRow = (fromKey: string, toKey: string, origin: string) =>
			linkRowsAfterSync.some(
				(row) => row.fromKey === fromKey && row.toKey === toKey && row.origin === origin,
			);
		assert(
			hasRow(parentDraft.itemKey, relatedDraft.itemKey, "manual") &&
				hasRow(parentDraft.itemKey, relatedDraft.itemKey, sourceOrigin) &&
				hasRow(relatedDraft.itemKey, parentDraft.itemKey, sourceOrigin) &&
				linkRowsAfterSync.length === 3,
			`Inbound sync did not mirror the related link on both items as expected: ${JSON.stringify(linkRowsAfterSync)}`,
		);
		const unlinkDraft = await openItemDraft(database, parentDraft.itemKey);
		await saveItemDraft(database, {
			itemKey: parentDraft.itemKey,
			expectedDraftGeneration: unlinkDraft.generation,
			expectedDraftRevision: unlinkDraft.draftRevision,
			expectedPayload: unlinkDraft.payload,
			payload: {
				...unlinkDraft.payload,
				links: { cites: [attachmentDraft.itemKey], related: [] },
			},
		});
		await publishItemDraft(database, parentDraft.itemKey);
		await drainWriteback(database, config, itemKeys, "related-remove");
		const [remoteParentUnlinked, remoteRelatedUnlinked] = await Promise.all([
			remoteItem(zotero.client, zotero.prefix, parentDraft.itemKey),
			remoteItem(zotero.client, zotero.prefix, relatedDraft.itemKey),
		]);
		const parentAfter = remoteParentUnlinked.data.relations as Record<string, unknown>;
		const relatedAfter = remoteRelatedUnlinked.data.relations as Record<string, unknown>;
		assert(
			parentAfter["dc:relation"] === undefined &&
				parentAfter["owl:sameAs"] === sameAsUri &&
				relatedAfter["dc:relation"] === undefined,
			`Removing the related link did not clear both Zotero items: ${JSON.stringify({ parentAfter, relatedAfter })}`,
		);
		const linkRowsAfterRemove = await database
			.select({ fromKey: itemLink.fromKey })
			.from(itemLink)
			.where(
				and(
					eq(itemLink.kind, "related"),
					inArray(itemLink.fromKey, [parentDraft.itemKey, relatedDraft.itemKey]),
				),
			);
		assert(
			linkRowsAfterRemove.length === 0,
			`Removing the related link left rows behind: ${JSON.stringify(linkRowsAfterRemove)}`,
		);
		await removeNativeItem(database, relatedDraft.itemKey);
		await drainWriteback(database, config, itemKeys, "related-delete");
		assert(
			await remoteItemIsMissing(zotero.client, zotero.prefix, relatedDraft.itemKey),
			"Deleting the related record did not delete its Zotero item",
		);

		await removeNativeItem(database, attachmentDraft.itemKey);
		await drainWriteback(database, config, itemKeys, "attachment-delete");
		assert(
			await remoteItemIsMissing(
				zotero.client,
				zotero.prefix,
				attachmentDraft.itemKey,
			),
			"Deleting the native attachment did not delete the Zotero child",
		);
		assert(
			!(await remoteItemIsMissing(
				zotero.client,
				zotero.prefix,
				parentDraft.itemKey,
			)),
			"Deleting the native attachment also deleted its Zotero parent",
		);

		await removeNativeItem(database, parentDraft.itemKey);
		await drainWriteback(database, config, itemKeys, "parent-delete");
		assert(
			await remoteItemIsMissing(
				zotero.client,
				zotero.prefix,
				parentDraft.itemKey,
			),
			"Deleting the native parent did not delete the Zotero parent",
		);

		const finalInbound = await runSourceConnection({
			credentialResolver: syncRuntime.credentialResolver,
			database,
			registry: syncRuntime.registry,
			sourceConnectionKey: LIVE_ZOTERO_CONNECTION_KEY,
			workerId: `zotero-live-writeback-deletions:${process.pid}`,
		});
		const finalLinks = await database
			.select({
				dirtyFields: itemSourceLink.dirtyFields,
				remoteDeleted: itemSourceLink.remoteDeleted,
			})
			.from(itemSourceLink)
			.where(
				and(
					inArray(itemSourceLink.itemKey, itemKeys),
					eq(
						itemSourceLink.sourceConnectionKey,
						LIVE_ZOTERO_CONNECTION_KEY,
					),
				),
			);
		assert(
			finalLinks.length === itemKeys.length &&
				finalLinks.every(
					(link) =>
						link.remoteDeleted && link.dirtyFields.length === 0,
				),
			"Final inbound sync did not acknowledge both remote deletions",
		);
		assert(
			(await actionableWritebackJobs(database)) === 0,
			"Live verification left actionable writeback jobs",
		);

		console.log(
			JSON.stringify(
				{
					attachmentKey: attachmentDraft.itemKey,
					finalInbound,
					groupId: ZOTERO_PLAYGROUND.groupId,
					inbound,
					conflictChoices: ["send-local", "load-remote"],
					metadataWriteback,
					parentKey: parentDraft.itemKey,
					status: "ok",
				},
				null,
				2,
			),
		);
	} finally {
		if (zoteroClient && zoteroPrefix) {
			for (const itemKey of itemKeys.toReversed()) {
				await deleteRemoteIfPresent(
					zoteroClient,
					zoteroPrefix,
					itemKey,
				).catch((error) =>
					console.error(
						`Failed to clean up Zotero item ${itemKey}`,
						error,
					),
				);
			}
		}
		await storage
			.removePrivate([...privatePaths])
			.catch((error) =>
				console.error("Failed to clean up private test files", error),
			);
		await storage
			.removePublic([...publicPaths])
			.catch((error) =>
				console.error("Failed to clean up public test files", error),
			);
		try {
			await cleanupLocalItems(database, itemKeys);
		} finally {
			await databaseResource.dispose();
		}
	}
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
	verifyLiveWriteback().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
