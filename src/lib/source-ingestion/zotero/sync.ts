import {
	collectionIdentity,
	itemSourceLink,
} from "@opendeved/evidence-library-core";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { sourceSnapshot } from "@/db/schema/source";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";

import type { SourceCredentialResolver } from "../credentials";
import type { SourceIngestionBatch } from "../batch-schema";
import { chunkValues } from "@/lib/chunk-values";
import { writeSourceIngestionBatch } from "../transactional-writer";
import { ZOTERO_OBJECT_REQUEST_SIZE, type ZoteroApiClient } from "./client";
import {
	createZoteroConnectionClient,
	loadZoteroSourceConnection,
	ZoteroSourceConfigurationError,
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

type Fetch = typeof fetch;

type SyncZoteroSourceOptions = {
	attachmentProcessor?: ZoteroAttachmentProcessor;
	credentialResolver?: SourceCredentialResolver;
	database: Database;
	fetch?: Fetch;
	sourceConnectionKey: string;
	sleep?: (milliseconds: number) => Promise<void>;
};

type ManifestEntry =
	| {
			entity: "collection";
			operation: "delete";
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
		throw new ZoteroSourceConfigurationError(
			`Zotero snapshot has ${snapshotRecordCount} records, exceeding maxSnapshotRecords ${maxSnapshotRecords}`,
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
	const [staleSnapshot] = await database
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
		.limit(1);
	return Boolean(staleSnapshot);
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

function completedCursor(targetVersion: number, softTrash: SoftTrashState) {
	return {
		libraryVersion: targetVersion,
		softTrashedCollectionKeys: [
			...softTrash.softTrashedCollectionKeys,
		].sort(),
		softTrashedItemKeys: [...softTrash.softTrashedItemKeys].sort(),
	};
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
				sourceRecordKey,
			});
		}
	}
	return { ...manifest, entries: retainedEntries };
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
	const attachmentContext: ZoteroAttachmentProcessorContext = {
		client,
		prefix,
		sourceConnectionKey: options.sourceConnectionKey,
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
			let snapshotSince =
				"pending" in cursor && cursor.pending
					? cursor.pending.snapshotSince
					: requiresMappingReplay
						? 0
						: baseVersion;
			let manifest = await readManifest(
				client,
				prefix,
				snapshotSince,
				config.maxSnapshotRecords,
			);
			if (
				!("pending" in cursor && cursor.pending) &&
				baseVersion > 0 &&
				manifestRestoresTombstone(
					manifest,
					localState,
					previousSoftTrash,
				)
			) {
				snapshotSince = 0;
				manifest = await readManifest(
					client,
					prefix,
					0,
					config.maxSnapshotRecords,
				);
			}
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
				throw new ZoteroSourceConfigurationError(
					`Zotero manifest has ${manifest.entries.length} records, exceeding maxSnapshotRecords ${config.maxSnapshotRecords}`,
				);
			}
			let offset =
				"pending" in cursor &&
				cursor.pending?.targetVersion === manifest.targetVersion
					? cursor.pending.offset
					: 0;
			if (offset > manifest.entries.length) {
				offset = 0;
			}
			let expectedCursor = cursor;
			const fetchedAt = new Date();

			if (manifest.entries.length === 0) {
				const nextCursor = completedCursor(
					manifest.targetVersion,
					nextSoftTrash,
				);
				await writeSourceIngestionBatch(options.database, {
					collections: [],
					expectedCursor,
					fetchedAt,
					items: [],
					mappingProfileVersion: ZOTERO_MAPPING_PROFILE_VERSION,
					nextCursor,
					sourceConnectionKey: options.sourceConnectionKey,
				});
				await options.attachmentProcessor?.flushCleanup?.(
					options.sourceConnectionKey,
				);
				return {
					batches: 1,
					records: 0,
					targetVersion: manifest.targetVersion,
				};
			}

			let batches = 0;
			while (offset < manifest.entries.length) {
				const end = Math.min(
					offset + config.maxRecordsPerBatch,
					manifest.entries.length,
				);
				const mapped = await mapManifestEntries(
					manifest.entries.slice(offset, end),
					options.attachmentProcessor,
					excludedCollectionKeys,
					attachmentContext,
				);
				const nextCursor =
					end === manifest.entries.length
						? completedCursor(manifest.targetVersion, nextSoftTrash)
						: {
								libraryVersion: baseVersion,
								softTrashedCollectionKeys: [
									...previousSoftTrash.softTrashedCollectionKeys,
								].sort(),
								softTrashedItemKeys: [
									...previousSoftTrash.softTrashedItemKeys,
								].sort(),
								pending: {
									offset: end,
									snapshotSince,
									targetVersion: manifest.targetVersion,
								},
							};
				await writeSourceIngestionBatch(options.database, {
					...mapped,
					expectedCursor,
					fetchedAt,
					mappingProfileVersion: ZOTERO_MAPPING_PROFILE_VERSION,
					nextCursor,
					sourceConnectionKey: options.sourceConnectionKey,
				});
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
			};
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
