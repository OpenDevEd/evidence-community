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
	ZoteroSnapshotChangedError,
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
	zoteroPdfRule,
	zoteroPdfRuleKey,
	type ZoteroCollectionResponse,
	type ZoteroCursor,
	type ZoteroItemResponse,
} from "./schema";
import { ZOTERO_MAPPING_PROFILE_VERSION } from "./profile";
import { markSourceFileChoicesApplied, sourceFileChoicesFor } from "@/lib/admin/source-file-choice";
import { saveSourceDisplayName } from "../display-name";

type Fetch = typeof fetch;

type SyncZoteroSourceOptions = {
	attachmentProcessor?: ZoteroAttachmentProcessor;
	credentialResolver?: SourceCredentialResolver;
	database: Database;
	fetch?: Fetch;
	/** The library-wide publish tags a source read before it had its own PDF rule was read under. */
	legacyPublishTags?: readonly string[];
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

function currentLibraryVersion(cursor: ZoteroCursor) {
	return "libraryVersion" in cursor ? cursor.libraryVersion : 0;
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

/**
 * Fetches the listed records into `into`. Returns false when the library
 * moved past `targetVersion` while they were read: a record came back newer
 * than listed, or was gone. The next pass reads those again.
 */
async function fetchRecords<T extends { key: string; version: number }>(
	fetchChunk: (keys: string[]) => Promise<{ data: T[]; libraryVersion: number }>,
	versions: Record<string, number>,
	keys: string[],
	targetVersion: number,
	into: Map<string, T>,
) {
	let settled = true;
	for (const keyChunk of chunkValues(keys, ZOTERO_OBJECT_REQUEST_SIZE)) {
		const response = await fetchChunk(keyChunk);
		if (response.libraryVersion !== targetVersion) settled = false;
		const returned = new Map(
			response.data.map((record) => [record.key, record]),
		);
		for (const key of keyChunk) {
			const record = returned.get(key);
			if (!record || record.version !== versions[key]) settled = false;
			if (record) into.set(key, record);
		}
	}
	return settled;
}

/** Moves one pass's deletions into the read: deleted keys leave it, listed keys stop counting as deleted. */
function applyDeletions<T>(
	records: Map<string, T>,
	deletedKeys: Set<string>,
	passDeleted: ReadonlySet<string>,
	passListed: readonly string[],
) {
	for (const key of passDeleted) {
		deletedKeys.add(key);
		records.delete(key);
	}
	for (const key of passListed) deletedKeys.delete(key);
}

type SnapshotReader = {
	client: ZoteroApiClient;
	prefix: string;
	maxSnapshotRecords: number;
	/** How many passes a read may take while the library keeps changing. */
	maxPasses: number;
	sleep: (milliseconds: number) => Promise<void>;
	/** Items read again even when Zotero didn't change them: attachments whose PDF choice isn't applied yet. */
	alsoReadItemKeys?: readonly string[];
};

/** Reads the items a read must hold though Zotero didn't change them, unless it already holds or deletes them. */
async function readAlso(reader: SnapshotReader, itemsByKey: Map<string, ZoteroItemResponse>, deletedItemKeys: ReadonlySet<string>) {
	const unread = (reader.alsoReadItemKeys ?? []).filter((key) => !itemsByKey.has(key) && !deletedItemKeys.has(key));
	for (const keyChunk of chunkValues(unread, ZOTERO_OBJECT_REQUEST_SIZE))
		for (const record of (await reader.client.items(reader.prefix, keyChunk)).data) itemsByKey.set(record.key, record);
}

/**
 * Reads everything that changed since `since`. When the library changes
 * during a pass, the records already read are kept and the next pass reads
 * only what changed since the version that pass started at, waiting longer
 * each time so the other client can finish (Zotero's sync guide, step 3.iii).
 * The read ends at the first pass the library holds still for.
 */
async function readManifest(reader: SnapshotReader, since: number) {
	const { client, prefix, maxSnapshotRecords } = reader;
	const collectionsByKey = new Map<string, ZoteroCollectionResponse>();
	const itemsByKey = new Map<string, ZoteroItemResponse>();
	const deletedCollectionKeys = new Set<string>();
	const deletedItemKeys = new Set<string>();
	let passSince = since;
	let targetVersion: number;
	for (let pass = 0; ; pass += 1) {
		const collectionVersions = await client.versions(
			prefix,
			"collections",
			passSince,
		);
		targetVersion = collectionVersions.libraryVersion;
		const itemVersions = await client.versions(prefix, "items", passSince);
		const deleted = await client.deleted(prefix, passSince);

		const passDeletedCollections = new Set(deleted.data.collections);
		const passDeletedItems = new Set(deleted.data.items);
		const collectionKeys = Object.keys(collectionVersions.data)
			.filter((key) => !passDeletedCollections.has(key))
			.sort();
		const itemKeys = Object.keys(itemVersions.data)
			.filter((key) => !passDeletedItems.has(key))
			.sort();
		applyDeletions(collectionsByKey, deletedCollectionKeys, passDeletedCollections, collectionKeys);
		applyDeletions(itemsByKey, deletedItemKeys, passDeletedItems, itemKeys);
		// Counts what the whole read will hold, earlier passes included.
		const snapshotRecordCount =
			new Set([...collectionsByKey.keys(), ...collectionKeys]).size +
			new Set([...itemsByKey.keys(), ...itemKeys]).size +
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
		const collectionsSettled = await fetchRecords(
			(keys) => client.collections(prefix, keys),
			collectionVersions.data,
			collectionKeys,
			targetVersion,
			collectionsByKey,
		);
		const itemsSettled = await fetchRecords(
			(keys) => client.items(prefix, keys),
			itemVersions.data,
			itemKeys,
			targetVersion,
			itemsByKey,
		);
		if (
			itemVersions.libraryVersion === targetVersion &&
			deleted.libraryVersion === targetVersion &&
			collectionsSettled &&
			itemsSettled
		) {
			break;
		}
		if (pass === reader.maxPasses - 1) throw new ZoteroSnapshotChangedError();
		passSince = targetVersion;
		await reader.sleep(Math.min(100 * 2 ** pass, 2_000));
	}
	await readAlso(reader, itemsByKey, deletedItemKeys);
	const collections = [...collectionsByKey.values()];
	const items = [...itemsByKey.values()];

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

function completedCursor(targetVersion: number, softTrash: SoftTrashState, pdfRule: string) {
	return {
		libraryVersion: targetVersion,
		softTrashedCollectionKeys: [
			...softTrash.softTrashedCollectionKeys,
		].sort(),
		softTrashedItemKeys: [...softTrash.softTrashedItemKeys].sort(),
		pdfRule,
	};
}

/** The cursor of a read that stopped part-way: the last complete read's state, plus where this one got to. */
function pendingCursor(
	cursor: ZoteroCursor,
	previousSoftTrash: SoftTrashState,
	read: { offset: number; snapshotSince: number; targetVersion: number; pdfRule: string; alsoRead: readonly string[] },
) {
	return {
		libraryVersion: currentLibraryVersion(cursor),
		softTrashedCollectionKeys: [...previousSoftTrash.softTrashedCollectionKeys].sort(),
		softTrashedItemKeys: [...previousSoftTrash.softTrashedItemKeys].sort(),
		// Kept until the read completes, so an interrupted change is read again in full.
		...("pdfRule" in cursor && cursor.pdfRule !== undefined ? { pdfRule: cursor.pdfRule } : {}),
		...("pdfs" in cursor && cursor.pdfs === false ? { pdfs: false as const } : {}),
		pending: {
			offset: read.offset,
			snapshotSince: read.snapshotSince,
			targetVersion: read.targetVersion,
			pdfRule: read.pdfRule,
			...(read.alsoRead.length ? { alsoRead: [...read.alsoRead] } : {}),
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
	reader: SnapshotReader,
	read: {
		start: { snapshotSince: number; resumes: boolean };
		baseVersion: number;
		localState: LocalSourceState;
		previousSoftTrash: SoftTrashState;
	},
) {
	const manifest = await readManifest(reader, read.start.snapshotSince);
	const restores =
		!read.start.resumes &&
		read.baseVersion > 0 &&
		manifestRestoresTombstone(manifest, read.localState, read.previousSoftTrash);
	if (!restores) return { manifest, snapshotSince: read.start.snapshotSince };
	return { manifest: await readManifest(reader, 0), snapshotSince: 0 };
}

/**
 * Where a read starts. An unfinished read under the same PDF rule carries on
 * where it stopped. A mapping change, a PDF rule change, or an unfinished read
 * under another rule starts from the beginning, so every record is read again
 * and its PDF is published or taken down to match. Otherwise it reads what
 * changed since the last complete read.
 */
function readStart(cursor: ZoteroCursor, replay: boolean, pdfRule: string, legacy: string) {
	const pending = "pending" in cursor ? cursor.pending : undefined;
	if (pending && recordedPdfRule(pending, legacy) === pdfRule) {
		return { snapshotSince: pending.snapshotSince, resumes: true };
	}
	const fromStart = Boolean(pending) || replay || ("libraryVersion" in cursor && recordedPdfRule(cursor, legacy) !== pdfRule);
	return { snapshotSince: fromStart ? 0 : currentLibraryVersion(cursor), resumes: false };
}

/**
 * The PDF rule a read followed. One saved before the rule was recorded left PDFs out (`pdfs: false`), or added the PDFs
 * carrying one of the library-wide publish tags: the legacy rule. A library update reads nothing again by itself, and a
 * new rule that differs from what it read under reads the group again.
 */
function recordedPdfRule(read: { pdfRule?: string; pdfs?: false }, legacy: string) {
	if (read.pdfRule !== undefined) return read.pdfRule;
	return read.pdfs === false ? zoteroPdfRuleKey({ mode: "off" }) : legacy;
}

/**
 * The rule a read saved before sources had their own followed: the library-wide tags. Unknown, it added PDFs under
 * whatever rule is current, unless PDFs are now off.
 */
function legacyPdfRule(options: SyncZoteroSourceOptions, current: string) {
	if (options.legacyPublishTags) return zoteroPdfRuleKey({ mode: "tagged", tags: options.legacyPublishTags });
	return current === zoteroPdfRuleKey({ mode: "off" }) ? "added" : current;
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
		pdfRule: string;
		alsoRead: readonly string[];
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
				? completedCursor(manifest.targetVersion, nextSoftTrash, read.pdfRule)
				: pendingCursor(cursor, previousSoftTrash, {
						offset: end,
						snapshotSince,
						targetVersion: manifest.targetVersion,
						pdfRule: read.pdfRule,
						alsoRead: read.alsoRead,
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
	const { choices, unapplied } = await sourceFileChoicesFor(options.database, options.sourceConnectionKey);
	const attachmentContext: ZoteroAttachmentProcessorContext = {
		client,
		prefix,
		sourceConnectionKey: options.sourceConnectionKey,
		pdfs: zoteroPdfRule(config),
		choices,
	};
	const pdfRule = zoteroPdfRuleKey(attachmentContext.pdfs);
	await options.attachmentProcessor?.flushCleanup?.(
		options.sourceConnectionKey,
	);

	const cursor = zoteroCursorSchema.parse(connection.syncCursor);
	const baseVersion = currentLibraryVersion(cursor);
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
	const start = readStart(cursor, requiresMappingReplay, pdfRule, legacyPdfRule(options, pdfRule));
	// A read that resumes holds the same entries it started with, so its offset still points where it stopped.
	const alsoRead = start.resumes && "pending" in cursor ? (cursor.pending?.alsoRead ?? []) : unapplied.map((row) => row.sourceRecordKey);
	const applying = unapplied.filter((row) => alsoRead.includes(row.sourceRecordKey));
	const snapshot = await readSnapshot(
		{
			client,
			prefix,
			maxSnapshotRecords: config.maxSnapshotRecords,
			maxPasses: config.maxConsistencyRetries,
			sleep: options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
			alsoReadItemKeys: alsoRead,
		},
		{
			start,
			baseVersion,
			localState,
			previousSoftTrash,
		},
	);
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
		const result = await completeEmptyRead(options, {
			expectedConfiguration: connection.config,
			expectedCursor,
			fetchedAt,
			nextCursor: completedCursor(manifest.targetVersion, nextSoftTrash, pdfRule),
			targetVersion: manifest.targetVersion,
		});
		await markSourceFileChoicesApplied(options.database, applying);
		return result;
	}

	const result = await writeManifestBatches(options, {
		manifest,
		offset,
		cursor,
		previousSoftTrash,
		nextSoftTrash,
		snapshotSince,
		excludedCollectionKeys,
		attachmentContext,
		fetchedAt,
		pdfRule,
		alsoRead,
		maxRecordsPerBatch: config.maxRecordsPerBatch,
		expectedConfiguration: connection.config,
	});
	await markSourceFileChoicesApplied(options.database, applying);
	return result;
}
