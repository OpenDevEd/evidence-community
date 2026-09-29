import {
	collectionIdentity,
	collectionSourceSnapshot,
	itemSourceLink,
} from "@opendeved/evidence-library-core";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { sourceSnapshot } from "@/db/schema/source";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";

import type { SourceRunProgress } from "../adapter";
import type { SourceCredentialResolver } from "../credentials";
import type { SourceIngestionBatch } from "../batch-schema";
import { chunkValues } from "@/lib/chunk-values";
import { writeSourceIngestionBatch } from "../transactional-writer";
import { ZOTERO_OBJECT_REQUEST_SIZE, type ZoteroApiClient } from "./client";
import {
	createZoteroConnectionClient,
	loadZoteroSourceConnection,
	ZoteroSourceConfigurationError,
	ZoteroSnapshotTooLargeError,
} from "./connection";
import {
	mapZoteroCollection,
	mapZoteroItem,
	type ZoteroAttachmentProcessor,
	type ZoteroAttachmentProcessorContext,
} from "./mapper";
import {
	zoteroCursorSchema,
	type ZoteroCollectionResponse,
	type ZoteroCursor,
	type ZoteroItemResponse,
} from "./schema";
import { ZOTERO_MAPPING_PROFILE_VERSION } from "./profile";
import { saveSourceDisplayName } from "../display-name";

type Fetch = typeof fetch;

type SyncZoteroSourceOptions = {
	attachmentProcessor?: ZoteroAttachmentProcessor;
	credentialResolver?: SourceCredentialResolver;
	database: Database;
	fetch?: Fetch;
	/** The import run, when an orchestrator started this sync. */
	run?: SourceRunProgress;
	sourceConnectionKey: string;
	sleep?: (milliseconds: number) => Promise<void>;
};

type ManifestEntry =
	| {
			entity: "collection";
			operation: "delete";
			remoteVersion: string | null;
			response?: ZoteroCollectionResponse;
			sourceRecordKey: string;
	  }
	| {
			entity: "collection";
			operation: "upsert";
			response: ZoteroCollectionResponse;
			sourceRecordKey: string;
	  }
	| {
			entity: "item";
			operation: "delete";
			remoteVersion: string | null;
			response?: ZoteroItemResponse;
			sourceRecordKey: string;
	  }
	| {
			entity: "item";
			operation: "upsert";
			response: ZoteroItemResponse;
			sourceRecordKey: string;
	  };

type LocalSourceState = {
	collections: {
		deleted: number | null;
		key: string;
		parentCollection: string | null;
		sourceRecordKey: string;
	}[];
	items: {
		deleted: number | null;
		key: string;
		parentItem: string | null;
		sourceRecordKey: string;
	}[];
};

type ZoteroManifest = {
	entries: ManifestEntry[];
	softTrashedCollectionKeys: Set<string>;
	softTrashedItemKeys: Set<string>;
	targetVersion: number;
	trashedCollectionKeys: Set<string>;
	trashedItemKeys: Set<string>;
};

type SoftTrashState = {
	softTrashedCollectionKeys: Set<string>;
	softTrashedItemKeys: Set<string>;
};

export class ZoteroSnapshotChangedError extends Error {
	constructor() {
		super("Zotero library changed while its sync snapshot was read");
		this.name = "ZoteroSnapshotChangedError";
	}
}

function currentLibraryVersion(cursor: ZoteroCursor) {
	return "libraryVersion" in cursor ? cursor.libraryVersion : 0;
}

function assertSnapshotVersion(actual: number, expected: number) {
	if (actual !== expected) throw new ZoteroSnapshotChangedError();
}

function isTrashed(value: unknown) {
	return value === true || value === 1;
}

function trashedSubtreeKeys<T>(
	records: T[],
	keyFor: (record: T) => string,
	parentFor: (record: T) => string | null,
	isDirectlyTrashed: (record: T) => boolean,
	permanentlyDeletedKeys: ReadonlySet<string>,
) {
	const trashed = new Set(permanentlyDeletedKeys);
	for (const record of records.filter(isDirectlyTrashed)) {
		trashed.add(keyFor(record));
	}
	let changed = true;
	while (changed) {
		changed = false;
		for (const record of records) {
			const key = keyFor(record);
			const parentKey = parentFor(record);
			if (!trashed.has(key) && parentKey && trashed.has(parentKey)) {
				trashed.add(key);
				changed = true;
			}
		}
	}
	return trashed;
}

function topologicalOrder<T>(
	records: T[],
	keyFor: (record: T) => string,
	parentFor: (record: T) => string | null,
	entity: string,
) {
	const recordByKey = new Map(
		records.map((record) => [keyFor(record), record]),
	);
	const state = new Map<string, "done" | "visiting">();
	const ordered: T[] = [];

	const visit = (record: T) => {
		const key = keyFor(record);
		const currentState = state.get(key);
		if (currentState === "done") return;
		if (currentState === "visiting") {
			throw new ZoteroSourceConfigurationError(
				`Zotero ${entity} parents contain a cycle`,
			);
		}
		state.set(key, "visiting");
		const parentKey = parentFor(record);
		const parent = parentKey ? recordByKey.get(parentKey) : undefined;
		if (parent) visit(parent);
		state.set(key, "done");
		ordered.push(record);
	};

	for (const record of [...records].sort((left, right) =>
		keyFor(left).localeCompare(keyFor(right)),
	)) {
		visit(record);
	}
	return ordered;
}

async function fetchCollections(
	client: ZoteroApiClient,
	prefix: string,
	keys: string[],
	targetVersion: number,
) {
	const records: ZoteroCollectionResponse[] = [];
	for (const keyChunk of chunkValues(keys, ZOTERO_OBJECT_REQUEST_SIZE)) {
		const response = await client.collections(prefix, keyChunk);
		assertSnapshotVersion(response.libraryVersion, targetVersion);
		const returned = new Map(
			response.data.map((record) => [record.key, record]),
		);
		for (const key of keyChunk) {
			const record = returned.get(key);
			if (!record) throw new ZoteroSnapshotChangedError();
			records.push(record);
		}
	}
	return records;
}

async function fetchItems(
	client: ZoteroApiClient,
	prefix: string,
	keys: string[],
	targetVersion: number,
) {
	const records: ZoteroItemResponse[] = [];
	for (const keyChunk of chunkValues(keys, ZOTERO_OBJECT_REQUEST_SIZE)) {
		const response = await client.items(prefix, keyChunk);
		assertSnapshotVersion(response.libraryVersion, targetVersion);
		const returned = new Map(
			response.data.map((record) => [record.key, record]),
		);
		for (const key of keyChunk) {
			const record = returned.get(key);
			if (!record) throw new ZoteroSnapshotChangedError();
			records.push(record);
		}
	}
	return records;
}

async function readManifest(
	client: ZoteroApiClient,
	prefix: string,
	since: number,
	maxSnapshotRecords: number,
) {
	const collectionVersions = await client.versions(
		prefix,
		"collections",
		since,
	);
	const targetVersion = collectionVersions.libraryVersion;
	const itemVersions = await client.versions(prefix, "items", since);
	assertSnapshotVersion(itemVersions.libraryVersion, targetVersion);
	const deleted = await client.deleted(prefix, since);
	assertSnapshotVersion(deleted.libraryVersion, targetVersion);

	const deletedCollectionKeys = new Set(deleted.data.collections);
	const deletedItemKeys = new Set(deleted.data.items);
	const collectionKeys = Object.keys(collectionVersions.data)
		.filter((key) => !deletedCollectionKeys.has(key))
		.sort();
	const itemKeys = Object.keys(itemVersions.data)
		.filter((key) => !deletedItemKeys.has(key))
		.sort();
	const snapshotRecordCount =
		collectionKeys.length +
		itemKeys.length +
		deletedCollectionKeys.size +
		deletedItemKeys.size;
	if (snapshotRecordCount > maxSnapshotRecords) {
		throw new ZoteroSnapshotTooLargeError(
			"snapshot",
			snapshotRecordCount,
			maxSnapshotRecords,
		);
	}
	// Keep requests sequential so that Zotero's shared Backoff response
	// applies before the next request starts.
	const collections = await fetchCollections(
		client,
		prefix,
		collectionKeys,
		targetVersion,
	);
	const items = await fetchItems(client, prefix, itemKeys, targetVersion);

	for (const record of collections) {
		if (record.version !== collectionVersions.data[record.key]) {
			throw new ZoteroSnapshotChangedError();
		}
	}
	for (const record of items) {
		if (record.version !== itemVersions.data[record.key]) {
			throw new ZoteroSnapshotChangedError();
		}
	}

	const softTrashedCollectionKeys = trashedSubtreeKeys(
		collections,
		(record) => record.key,
		(record) =>
			typeof record.data.parentCollection === "string"
				? record.data.parentCollection
				: null,
		(record) => isTrashed(record.data.deleted),
		new Set(),
	);
	const trashedCollectionKeys = trashedSubtreeKeys(
		collections,
		(record) => record.key,
		(record) =>
			typeof record.data.parentCollection === "string"
				? record.data.parentCollection
				: null,
		(record) => isTrashed(record.data.deleted),
		deletedCollectionKeys,
	);
	const softTrashedItemKeys = trashedSubtreeKeys(
		items,
		(record) => record.key,
		(record) => record.data.parentItem ?? null,
		(record) => isTrashed(record.data.deleted),
		new Set(),
	);
	const trashedItemKeys = trashedSubtreeKeys(
		items,
		(record) => record.key,
		(record) => record.data.parentItem ?? null,
		(record) => isTrashed(record.data.deleted),
		deletedItemKeys,
	);
	const activeCollections = collections.filter(
		(record) => !trashedCollectionKeys.has(record.key),
	);
	const trashedCollections = collections.filter((record) =>
		trashedCollectionKeys.has(record.key),
	);
	const activeItems = items.filter(
		(record) => !trashedItemKeys.has(record.key),
	);
	const trashedItems = items.filter((record) =>
		trashedItemKeys.has(record.key),
	);
	const orderedCollections = topologicalOrder(
		activeCollections,
		(record) => record.key,
		(record) =>
			typeof record.data.parentCollection === "string"
				? record.data.parentCollection
				: null,
		"collection",
	);
	const orderedItems = topologicalOrder(
		activeItems,
		(record) => record.key,
		(record) => record.data.parentItem ?? null,
		"item",
	);

	const entries: ManifestEntry[] = [
		...orderedCollections.map((response): ManifestEntry => ({
			entity: "collection",
			operation: "upsert",
			response,
			sourceRecordKey: response.key,
		})),
		...orderedItems.map((response): ManifestEntry => ({
			entity: "item",
			operation: "upsert",
			response,
			sourceRecordKey: response.key,
		})),
		...trashedItems
			.sort((left, right) => left.key.localeCompare(right.key))
			.map((response): ManifestEntry => ({
				entity: "item",
				operation: "delete",
				remoteVersion: String(response.version),
				response,
				sourceRecordKey: response.key,
			})),
		...trashedCollections
			.sort((left, right) => left.key.localeCompare(right.key))
			.map((response): ManifestEntry => ({
				entity: "collection",
				operation: "delete",
				remoteVersion: String(response.version),
				response,
				sourceRecordKey: response.key,
			})),
		...[...deletedItemKeys]
			.sort()
			.map((sourceRecordKey): ManifestEntry => ({
				entity: "item",
				operation: "delete",
				remoteVersion: null,
				sourceRecordKey,
			})),
		...[...deletedCollectionKeys]
			.sort()
			.map((sourceRecordKey): ManifestEntry => ({
				entity: "collection",
				operation: "delete",
				remoteVersion: null,
				sourceRecordKey,
			})),
	];

	return {
		entries,
		softTrashedCollectionKeys,
		softTrashedItemKeys,
		targetVersion,
		trashedCollectionKeys,
		trashedItemKeys,
	};
}

async function mapManifestEntries(
	entries: ManifestEntry[],
	attachmentProcessor?: ZoteroAttachmentProcessor,
	excludedCollectionKeys: ReadonlySet<string> = new Set(),
	attachmentContext?: ZoteroAttachmentProcessorContext,
) {
	const items: SourceIngestionBatch["items"] = [];
	const collections: SourceIngestionBatch["collections"] = [];
	for (const entry of entries) {
		if (entry.entity === "collection") {
			collections.push(
				entry.operation === "upsert"
					? mapZoteroCollection(entry.response)
					: {
							operation: "delete",
							sourceRecordKey: entry.sourceRecordKey,
							remoteVersion: entry.remoteVersion,
							raw: entry.response
								? (entry.response as never)
								: { deleted: true },
						},
			);
			continue;
		}
		items.push(
			entry.operation === "upsert"
				? await mapZoteroItem(
						entry.response,
						attachmentProcessor,
						excludedCollectionKeys,
						attachmentContext,
					)
				: {
						operation: "delete",
						sourceRecordKey: entry.sourceRecordKey,
						remoteVersion: entry.remoteVersion,
						raw: entry.response
							? (entry.response as never)
							: { deleted: true },
					},
		);
	}
	return { collections, items };
}

async function loadLocalSourceState(
	database: Database,
	sourceConnectionKey: string,
): Promise<LocalSourceState> {
	const [items, collections] = await Promise.all([
		database
			.select({
				deleted: sql<number>`CASE WHEN ${itemSourceLink.remoteDeleted} THEN 1 ELSE 0 END`,
				key: item.key,
				parentItem: item.parentItem,
				sourceRecordKey: itemSourceLink.sourceRecordKey,
			})
			.from(itemSourceLink)
			.innerJoin(item, eq(itemSourceLink.itemKey, item.key))
			.where(eq(itemSourceLink.sourceConnectionKey, sourceConnectionKey)),
		database
			.select({
				deleted: collection.deleted,
				key: collection.key,
				parentCollection: collection.parentCollection,
				sourceRecordKey: collectionIdentity.sourceRecordKey,
			})
			.from(collectionIdentity)
			.innerJoin(collection, eq(collectionIdentity.key, collection.key))
			.where(
				eq(collectionIdentity.sourceConnectionKey, sourceConnectionKey),
			),
	]);
	return { collections, items };
}

async function mappingReplayRequired(
	database: Database,
	sourceConnectionKey: string,
) {
	const [[staleItemSnapshot], [staleCollectionSnapshot]] = await Promise.all([
		database
			.select({ itemKey: sourceSnapshot.itemKey })
			.from(sourceSnapshot)
			.where(
				and(
					eq(sourceSnapshot.sourceConnectionKey, sourceConnectionKey),
					or(
						isNull(sourceSnapshot.mappingProfileVersion),
						ne(
							sourceSnapshot.mappingProfileVersion,
							ZOTERO_MAPPING_PROFILE_VERSION,
						),
					),
				),
			)
			.limit(1),
		database
			.select({ collectionKey: collectionIdentity.key })
			.from(collectionIdentity)
			.leftJoin(
				collectionSourceSnapshot,
				and(
					eq(
						collectionSourceSnapshot.collectionKey,
						collectionIdentity.key,
					),
					eq(
						collectionSourceSnapshot.sourceConnectionKey,
						collectionIdentity.sourceConnectionKey,
					),
				),
			)
			.where(
				and(
					eq(
						collectionIdentity.sourceConnectionKey,
						sourceConnectionKey,
					),
					or(
						isNull(collectionSourceSnapshot.collectionKey),
						isNull(collectionSourceSnapshot.mappingProfileVersion),
						ne(
							collectionSourceSnapshot.mappingProfileVersion,
							ZOTERO_MAPPING_PROFILE_VERSION,
						),
					),
				),
			)
			.limit(1),
	]);
	return Boolean(staleItemSnapshot || staleCollectionSnapshot);
}

function manifestRestoresTombstone(
	manifest: ZoteroManifest,
	state: LocalSourceState,
	previousSoftTrash: SoftTrashState,
) {
	const itemTombstones = new Set(
		state.items
			.filter(({ deleted }) => deleted === 1)
			.map(({ sourceRecordKey }) => sourceRecordKey),
	);
	const collectionTombstones = new Set(
		state.collections
			.filter(({ deleted }) => deleted === 1)
			.map(({ sourceRecordKey }) => sourceRecordKey),
	);
	return manifest.entries.some(
		(entry) =>
			entry.operation === "upsert" &&
			(entry.entity === "item"
				? itemTombstones.has(entry.sourceRecordKey) ||
					previousSoftTrash.softTrashedItemKeys.has(
						entry.sourceRecordKey,
					)
				: collectionTombstones.has(entry.sourceRecordKey) ||
					previousSoftTrash.softTrashedCollectionKeys.has(
						entry.sourceRecordKey,
					)),
	);
}

function previousSoftTrashState(cursor: ZoteroCursor): SoftTrashState {
	return {
		softTrashedCollectionKeys: new Set(
			"softTrashedCollectionKeys" in cursor
				? cursor.softTrashedCollectionKeys
				: [],
		),
		softTrashedItemKeys: new Set(
			"softTrashedItemKeys" in cursor ? cursor.softTrashedItemKeys : [],
		),
	};
}

function nextSoftTrashState(
	manifest: ZoteroManifest,
	previous: SoftTrashState,
	snapshotSince: number,
): SoftTrashState {
	const next: SoftTrashState =
		snapshotSince === 0
			? {
					softTrashedCollectionKeys: new Set(),
					softTrashedItemKeys: new Set(),
				}
			: {
					softTrashedCollectionKeys: new Set(
						previous.softTrashedCollectionKeys,
					),
					softTrashedItemKeys: new Set(previous.softTrashedItemKeys),
				};
	for (const entry of manifest.entries) {
		(entry.entity === "item"
			? next.softTrashedItemKeys
			: next.softTrashedCollectionKeys
		).delete(entry.sourceRecordKey);
	}
	for (const key of manifest.softTrashedItemKeys) {
		next.softTrashedItemKeys.add(key);
	}
	for (const key of manifest.softTrashedCollectionKeys) {
		next.softTrashedCollectionKeys.add(key);
	}
	return next;
}

function completedCursor(targetVersion: number, softTrash: SoftTrashState, pdfs: boolean) {
	return {
		libraryVersion: targetVersion,
		softTrashedCollectionKeys: [
			...softTrash.softTrashedCollectionKeys,
		].sort(),
		softTrashedItemKeys: [...softTrash.softTrashedItemKeys].sort(),
		...pdfsField(pdfs),
	};
}

/** The cursor field recording a read that left PDFs out; absent when it added them. */
function pdfsField(pdfs: boolean) {
	return pdfs ? {} : { pdfs: false as const };
}

/**
 * Where a read starts. An unfinished read under the same PDF setting carries
 * on where it stopped. A mapping change, a PDF setting change, or an
 * unfinished read under the other setting starts from the beginning, so
 * every record is read again. Otherwise it reads what changed since the last
 * complete read.
 */
/** The cursor of a read that stopped part-way: the last complete read's state, plus where this one got to. */
function pendingCursor(
	cursor: ZoteroCursor,
	previousSoftTrash: SoftTrashState,
	read: { offset: number; snapshotSince: number; targetVersion: number; pdfs: boolean },
) {
	return {
		libraryVersion: currentLibraryVersion(cursor),
		softTrashedCollectionKeys: [...previousSoftTrash.softTrashedCollectionKeys].sort(),
		softTrashedItemKeys: [...previousSoftTrash.softTrashedItemKeys].sort(),
		// Kept until the read completes, so an interrupted change is read again in full.
		...pdfsField(cursorAddedPdfs(cursor)),
		pending: {
			offset: read.offset,
			snapshotSince: read.snapshotSince,
			targetVersion: read.targetVersion,
			...pdfsField(read.pdfs),
		},
	};
}

/** Where an unfinished read of the same snapshot carries on; anything else starts at the first record. */
function resumeOffset(cursor: ZoteroCursor, resumes: boolean, manifest: ZoteroManifest) {
	const pending = "pending" in cursor ? cursor.pending : undefined;
	const offset = resumes && pending?.targetVersion === manifest.targetVersion ? pending.offset : 0;
	return offset > manifest.entries.length ? 0 : offset;
}

/**
 * Reads the manifest from where the read starts. When it restores something
 * in the local trash, the read starts over from the beginning so unchanged
 * descendants and memberships come back with it.
 */
async function readSnapshot(
	client: ZoteroApiClient,
	prefix: string,
	maxSnapshotRecords: number,
	read: {
		start: { snapshotSince: number; resumes: boolean };
		baseVersion: number;
		localState: LocalSourceState;
		previousSoftTrash: SoftTrashState;
	},
) {
	const manifest = await readManifest(client, prefix, read.start.snapshotSince, maxSnapshotRecords);
	const restores =
		!read.start.resumes &&
		read.baseVersion > 0 &&
		manifestRestoresTombstone(manifest, read.localState, read.previousSoftTrash);
	if (!restores) return { manifest, snapshotSince: read.start.snapshotSince };
	return { manifest: await readManifest(client, prefix, 0, maxSnapshotRecords), snapshotSince: 0 };
}

function readStart(cursor: ZoteroCursor, replay: boolean, downloadPdfs: boolean) {
	const pending = "pending" in cursor ? cursor.pending : undefined;
	if (pending && (pending.pdfs ?? true) === downloadPdfs) {
		return { snapshotSince: pending.snapshotSince, resumes: true };
	}
	const fromStart = Boolean(pending) || replay || cursorAddedPdfs(cursor) !== downloadPdfs;
	return { snapshotSince: fromStart ? 0 : currentLibraryVersion(cursor), resumes: false };
}

/** Whether the last complete read added PDFs; a cursor from before the setting did. */
function cursorAddedPdfs(cursor: ZoteroCursor) {
	return !("pdfs" in cursor && cursor.pdfs === false);
}

function expandLocalDescendantKeys<
	T extends {
		key: string;
		sourceRecordKey: string;
	},
>(
	records: T[],
	parentFor: (record: T) => string | null,
	trashed: Set<string>,
	currentUpserts: ReadonlySet<string>,
) {
	const sourceKeyByCanonicalKey = new Map(
		records.map((record) => [record.key, record.sourceRecordKey]),
	);
	let changed = true;
	while (changed) {
		changed = false;
		for (const record of records) {
			if (currentUpserts.has(record.sourceRecordKey)) {
				continue;
			}
			const parentKey = parentFor(record);
			const parentSourceKey = parentKey
				? sourceKeyByCanonicalKey.get(parentKey)
				: null;
			if (
				parentSourceKey &&
				trashed.has(parentSourceKey) &&
				!trashed.has(record.sourceRecordKey)
			) {
				trashed.add(record.sourceRecordKey);
				changed = true;
			}
		}
	}
}

function manifestUpsertKeys(manifest: ZoteroManifest) {
	return {
		collectionUpserts: new Set(
			manifest.entries
				.filter(
					(entry) =>
						entry.entity === "collection" &&
						entry.operation === "upsert",
				)
				.map(({ sourceRecordKey }) => sourceRecordKey),
		),
		itemUpserts: new Set(
			manifest.entries
				.filter(
					(entry) =>
						entry.entity === "item" && entry.operation === "upsert",
				)
				.map(({ sourceRecordKey }) => sourceRecordKey),
		),
	};
}

function expandLocalDescendantDeletes(
	manifest: ZoteroManifest,
	state: LocalSourceState,
) {
	const { collectionUpserts, itemUpserts } = manifestUpsertKeys(manifest);
	expandLocalDescendantKeys(
		state.items,
		(record) => record.parentItem,
		manifest.trashedItemKeys,
		itemUpserts,
	);
	expandLocalDescendantKeys(
		state.collections,
		(record) => record.parentCollection,
		manifest.trashedCollectionKeys,
		collectionUpserts,
	);

	const retainedEntries = manifest.entries.filter(
		(entry) =>
			!(
				(entry.entity === "item"
					? manifest.trashedItemKeys
					: manifest.trashedCollectionKeys
				).has(entry.sourceRecordKey) && entry.operation === "upsert"
			),
	);
	const existingDeletes = new Set(
		retainedEntries
			.filter((entry) => entry.operation === "delete")
			.map((entry) => `${entry.entity}\u0000${entry.sourceRecordKey}`),
	);
	const localItemKeys = new Set(
		state.items.map(({ sourceRecordKey }) => sourceRecordKey),
	);
	const localCollectionKeys = new Set(
		state.collections.map(({ sourceRecordKey }) => sourceRecordKey),
	);
	for (const sourceRecordKey of [...manifest.trashedItemKeys].sort()) {
		const identity = `item\u0000${sourceRecordKey}`;
		if (
			localItemKeys.has(sourceRecordKey) &&
			!existingDeletes.has(identity)
		) {
			retainedEntries.push({
				entity: "item",
				operation: "delete",
				remoteVersion: null,
				sourceRecordKey,
			});
		}
	}
	for (const sourceRecordKey of [...manifest.trashedCollectionKeys].sort()) {
		const identity = `collection\u0000${sourceRecordKey}`;
		if (
			localCollectionKeys.has(sourceRecordKey) &&
			!existingDeletes.has(identity)
		) {
			retainedEntries.push({
				entity: "collection",
				operation: "delete",
				remoteVersion: null,
				sourceRecordKey,
			});
		}
	}
	return { ...manifest, entries: retainedEntries };
}

/** A read that found nothing new still moves the cursor on. */
async function completeEmptyRead(
	options: SyncZoteroSourceOptions,
	read: {
		expectedConfiguration: Record<string, unknown>;
		expectedCursor: ZoteroCursor;
		fetchedAt: Date;
		nextCursor: ReturnType<typeof completedCursor>;
		targetVersion: number;
	},
) {
	await writeSourceIngestionBatch(options.database, {
		collections: [],
		// A configuration changed since the read started, such as its PDF setting, rejects the batch.
		expectedConfiguration: read.expectedConfiguration,
		expectedCursor: read.expectedCursor,
		fetchedAt: read.fetchedAt,
		items: [],
		mappingProfileVersion: ZOTERO_MAPPING_PROFILE_VERSION,
		nextCursor: read.nextCursor,
		sourceConnectionKey: options.sourceConnectionKey,
		sourceSyncRunId: options.run?.id,
	});
	await options.attachmentProcessor?.flushCleanup?.(options.sourceConnectionKey);
	return { batches: 1, records: 0, targetVersion: read.targetVersion, unresolvedRelations: 0 };
}

/** Writes the manifest's records batch by batch; each batch moves the cursor on, so a restart carries on after it. */
async function writeManifestBatches(
	options: SyncZoteroSourceOptions,
	read: {
		manifest: ZoteroManifest;
		offset: number;
		cursor: ZoteroCursor;
		previousSoftTrash: SoftTrashState;
		nextSoftTrash: SoftTrashState;
		snapshotSince: number;
		excludedCollectionKeys: Set<string>;
		attachmentContext: ZoteroAttachmentProcessorContext;
		fetchedAt: Date;
		downloadPdfs: boolean;
		maxRecordsPerBatch: number;
		expectedConfiguration: Record<string, unknown>;
	},
) {
	const { manifest, cursor, previousSoftTrash, nextSoftTrash, snapshotSince, fetchedAt } = read;
	let offset = read.offset;
	let expectedCursor: ZoteroCursor = cursor;
	let batches = 0;
	let unresolvedRelations = 0;
	while (offset < manifest.entries.length) {
		const end = Math.min(
			offset + read.maxRecordsPerBatch,
			manifest.entries.length,
		);
		const mapped = await mapManifestEntries(
			manifest.entries.slice(offset, end),
			options.attachmentProcessor,
			read.excludedCollectionKeys,
			read.attachmentContext,
		);
		const nextCursor =
			end === manifest.entries.length
				? completedCursor(manifest.targetVersion, nextSoftTrash, read.downloadPdfs)
				: pendingCursor(cursor, previousSoftTrash, {
						offset: end,
						snapshotSince,
						targetVersion: manifest.targetVersion,
						pdfs: read.downloadPdfs,
					});
		const written = await writeSourceIngestionBatch(options.database, {
			...mapped,
			expectedConfiguration: read.expectedConfiguration,
			expectedCursor,
			fetchedAt,
			mappingProfileVersion: ZOTERO_MAPPING_PROFILE_VERSION,
			nextCursor,
			sourceConnectionKey: options.sourceConnectionKey,
			sourceSyncRunId: options.run?.id,
		});
		unresolvedRelations += written.written.unresolvedRelations;
		// The batch is durable now; slow file cleanup must not hold the count back.
		await options.run?.report(end, manifest.entries.length);
		await options.attachmentProcessor?.flushCleanup?.(
			options.sourceConnectionKey,
		);
		expectedCursor = nextCursor;
		offset = end;
		batches += 1;
	}
	return {
		batches,
		records: manifest.entries.length,
		targetVersion: manifest.targetVersion,
		unresolvedRelations,
	};
}

export async function syncZoteroSource(options: SyncZoteroSourceOptions) {
	const connection = await loadZoteroSourceConnection(
		options.database,
		options.sourceConnectionKey,
	);
	const { client, config, prefix, scope } =
		await createZoteroConnectionClient(connection, {
			credentialResolver: options.credentialResolver,
			fetch: options.fetch,
			sleep: options.sleep,
		});
	await client.verifyKeyAccess(scope);
	await saveSourceDisplayName(options.database, connection, () => client.libraryName(scope));
	const attachmentContext: ZoteroAttachmentProcessorContext = {
		client,
		prefix,
		sourceConnectionKey: options.sourceConnectionKey,
		publishPdfs: config.downloadPdfs,
	};
	await options.attachmentProcessor?.flushCleanup?.(
		options.sourceConnectionKey,
	);

	for (
		let attempt = 0;
		attempt < config.maxConsistencyRetries;
		attempt += 1
	) {
		const latestConnection = await loadZoteroSourceConnection(
			options.database,
			options.sourceConnectionKey,
		);
		const cursor = zoteroCursorSchema.parse(latestConnection.syncCursor);
		const baseVersion = currentLibraryVersion(cursor);
		try {
			const [localState, requiresMappingReplay] = await Promise.all([
				loadLocalSourceState(
					options.database,
					options.sourceConnectionKey,
				),
				mappingReplayRequired(
					options.database,
					options.sourceConnectionKey,
				),
			]);
			const previousSoftTrash = previousSoftTrashState(cursor);
			const start = readStart(cursor, requiresMappingReplay, config.downloadPdfs);
			const snapshot = await readSnapshot(client, prefix, config.maxSnapshotRecords, {
				start,
				baseVersion,
				localState,
				previousSoftTrash,
			});
			const snapshotSince = snapshot.snapshotSince;
			let manifest = snapshot.manifest;
			const nextSoftTrash = nextSoftTrashState(
				manifest,
				previousSoftTrash,
				snapshotSince,
			);
			manifest = expandLocalDescendantDeletes(manifest, localState);
			const { collectionUpserts, itemUpserts } =
				manifestUpsertKeys(manifest);
			expandLocalDescendantKeys(
				localState.items,
				(record) => record.parentItem,
				nextSoftTrash.softTrashedItemKeys,
				itemUpserts,
			);
			expandLocalDescendantKeys(
				localState.collections,
				(record) => record.parentCollection,
				nextSoftTrash.softTrashedCollectionKeys,
				collectionUpserts,
			);
			const excludedCollectionKeys = new Set([
				...nextSoftTrash.softTrashedCollectionKeys,
				...manifest.trashedCollectionKeys,
			]);
			if (manifest.entries.length > config.maxSnapshotRecords) {
				throw new ZoteroSnapshotTooLargeError(
					"manifest",
					manifest.entries.length,
					config.maxSnapshotRecords,
				);
			}
			const offset = resumeOffset(cursor, start.resumes, manifest);
			const expectedCursor = cursor;
			const fetchedAt = new Date();
			if (manifest.entries.length > 0) {
				await options.run?.report(offset, manifest.entries.length);
			}

			if (manifest.entries.length === 0) {
				return completeEmptyRead(options, {
					expectedConfiguration: connection.config,
					expectedCursor,
					fetchedAt,
					nextCursor: completedCursor(manifest.targetVersion, nextSoftTrash, config.downloadPdfs),
					targetVersion: manifest.targetVersion,
				});
			}

			return writeManifestBatches(options, {
				manifest,
				offset,
				cursor,
				previousSoftTrash,
				nextSoftTrash,
				snapshotSince,
				excludedCollectionKeys,
				attachmentContext,
				fetchedAt,
				downloadPdfs: config.downloadPdfs,
				maxRecordsPerBatch: config.maxRecordsPerBatch,
				expectedConfiguration: connection.config,
			});
		} catch (error) {
			if (
				!(error instanceof ZoteroSnapshotChangedError) ||
				attempt === config.maxConsistencyRetries - 1
			) {
				throw error;
			}
			await (
				options.sleep ??
				((milliseconds) =>
					new Promise((resolve) => setTimeout(resolve, milliseconds)))
			)(Math.min(100 * 2 ** attempt, 2_000));
		}
	}
	throw new ZoteroSnapshotChangedError();
}
