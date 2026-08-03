import {
	collectionIdentity,
	itemIdentity,
	outbox,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import {
	and,
	eq,
	getTableColumns,
	inArray,
	sql,
	type InferInsertModel,
} from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import {
	reserveCollectionIdentities,
	reserveItemIdentities,
} from "@/db/record-identity";
import {
	sourceRecordAlias,
	sourceSnapshot,
} from "@/db/schema/source";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { tag } from "@/db/schema/tables/tag";
import {
	NativeItemValidationError,
	validateNativeItemDraft,
} from "@/lib/admin/native-item-validation";

import {
	type JsonValue,
	type SourceIngestionBatch,
	sourceIngestionBatchSchema,
} from "./batch-schema";
import { chunkValues } from "./chunks";
import {
	canonicalSourceJson,
	sourceItemFingerprint,
	sourcePayloadHash,
} from "./fingerprint";

type Transaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];
type ItemInsert = InferInsertModel<typeof item>;
type CollectionInsert = InferInsertModel<typeof collection>;

const ITEM_UPSERT_CHUNK_SIZE = 200;
const RELATION_CHUNK_SIZE = 1_000;
const COLLECTION_UPSERT_CHUNK_SIZE = 1_000;

const itemColumns = getTableColumns(item);
const sourceWritableItemFields = Object.keys(itemColumns).filter(
	(field) =>
		!new Set([
			"createdAt",
			"deleted",
			"deletedAt",
			"key",
			"parentItem",
			"revision",
			"sourceConnectionKey",
			"sourceRecordKey",
			"updatedAt",
		]).has(field),
);

export class SourceIngestionValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SourceIngestionValidationError";
	}
}

export class SourceConnectionUnavailableError extends Error {
	constructor(sourceConnectionKey: string) {
		super(`Source connection is unavailable: ${sourceConnectionKey}`);
		this.name = "SourceConnectionUnavailableError";
	}
}

export class SourceCursorConflictError extends Error {
	constructor(sourceConnectionKey: string) {
		super(`Source cursor is stale: ${sourceConnectionKey}`);
		this.name = "SourceCursorConflictError";
	}
}

export class SourceReferenceNotFoundError extends Error {
	constructor(entity: "collection" | "item", reference: string) {
		super(`Referenced ${entity} was not found: ${reference}`);
		this.name = "SourceReferenceNotFoundError";
	}
}

export class SourceAliasConflictError extends Error {
	constructor(aliasKey: string) {
		super(`Source alias belongs to another item: ${aliasKey}`);
		this.name = "SourceAliasConflictError";
	}
}

export class SourceRelationshipCycleError extends Error {
	constructor(entity: "collection" | "item") {
		super(`Source ${entity} parent relationships contain a cycle`);
		this.name = "SourceRelationshipCycleError";
	}
}

function jsonEqual(left: JsonValue, right: JsonValue) {
	return canonicalSourceJson(left) === canonicalSourceJson(right);
}

function nullableJsonEqual(
	left: Record<string, unknown> | null,
	right: Record<string, unknown> | null,
) {
	if (left === null || right === null) return left === right;
	return jsonEqual(left as JsonValue, right as JsonValue);
}

function sourceItemValues(
	record: Extract<
		SourceIngestionBatch["items"][number],
		{ operation: "upsert" }
	>,
	fetchedAt: Date,
) {
	if (
		Object.hasOwn(record.metadata, "parentItem") ||
		Object.hasOwn(record.metadata, "collections")
	) {
		throw new SourceIngestionValidationError(
			"Source metadata must express parents and collections through batch references",
		);
	}

	let validated;
	try {
		validated = validateNativeItemDraft(record.metadata, {
			requireAttachmentParent: false,
		});
	} catch (error) {
		if (error instanceof NativeItemValidationError) {
			throw new SourceIngestionValidationError(error.message);
		}
		throw error;
	}

	if (record.file && validated.item.itemType !== "Attachment") {
		throw new SourceIngestionValidationError(
			"Only Attachment records may contain source file metadata",
		);
	}

	const values = Object.fromEntries(
		sourceWritableItemFields.map((field) => [field, null]),
	) as Partial<ItemInsert>;
	Object.assign(values, validated.item);
	values.dateAdded = record.sourceDates?.addedAt ?? null;
	values.dateModified =
		record.sourceDates?.modifiedAt ?? fetchedAt;

	if (record.file) {
		values.url = record.file.url;
		values.contentType = record.file.contentType;
		values.filename = record.file.filename;
		values.linkMode = record.file.linkMode;
		values.md5 = record.file.md5;
		values.mtime = record.file.mtime;
		values.charset = record.file.charset;
		values.fullTextPDF = record.file.fullText;
		values.PDFCoverPageImage = record.file.coverUrl;
		values.PDFCoverPageWidth = record.file.coverWidth;
		values.PDFCoverPageHeight = record.file.coverHeight;
	}

	return {
		collectionReferences: record.collections,
		item: values,
		tags: validated.tags,
	};
}

async function loadIdentityMap(
	transaction: Transaction,
	entity: "collection" | "item",
	sourceConnectionKey: string,
	sourceRecordKeys: string[],
) {
	if (sourceRecordKeys.length === 0) return new Map<string, string>();
	const table =
		entity === "item" ? itemIdentity : collectionIdentity;
	const rows = await transaction
		.select({
			key: table.key,
			sourceRecordKey: table.sourceRecordKey,
		})
		.from(table)
		.where(
			and(
				eq(table.sourceConnectionKey, sourceConnectionKey),
				inArray(table.sourceRecordKey, sourceRecordKeys),
			),
		);
	return new Map(
		rows.map(({ key, sourceRecordKey }) => [sourceRecordKey, key]),
	);
}

async function resolveCollectionReferences(
	transaction: Transaction,
	currentSourceConnectionKey: string,
	references: Array<{
		sourceConnectionKey?: string;
		sourceRecordKey: string;
	}>,
	currentBatchKeys: Map<string, string>,
) {
	const resolved = new Map<string, string>();
	const unresolvedByConnection = new Map<string, Set<string>>();

	for (const reference of references) {
		const connectionKey =
			reference.sourceConnectionKey ?? currentSourceConnectionKey;
		const referenceId = `${connectionKey}\u0000${reference.sourceRecordKey}`;
		const currentBatchKey =
			connectionKey === currentSourceConnectionKey
				? currentBatchKeys.get(reference.sourceRecordKey)
				: undefined;
		if (currentBatchKey) {
			resolved.set(referenceId, currentBatchKey);
			continue;
		}
		const keys =
			unresolvedByConnection.get(connectionKey) ?? new Set<string>();
		keys.add(reference.sourceRecordKey);
		unresolvedByConnection.set(connectionKey, keys);
	}

	for (const [connectionKey, sourceRecordKeys] of unresolvedByConnection) {
		const rows = await transaction
			.select({
				key: collectionIdentity.key,
				sourceRecordKey: collectionIdentity.sourceRecordKey,
			})
			.from(collectionIdentity)
			.where(
				and(
					eq(
						collectionIdentity.sourceConnectionKey,
						connectionKey,
					),
					inArray(
						collectionIdentity.sourceRecordKey,
						[...sourceRecordKeys],
					),
				),
			);
		for (const row of rows) {
			resolved.set(
				`${connectionKey}\u0000${row.sourceRecordKey}`,
				row.key,
			);
		}
	}

	for (const reference of references) {
		const connectionKey =
			reference.sourceConnectionKey ?? currentSourceConnectionKey;
		const referenceId = `${connectionKey}\u0000${reference.sourceRecordKey}`;
		if (!resolved.has(referenceId)) {
			throw new SourceReferenceNotFoundError(
				"collection",
				`${connectionKey}/${reference.sourceRecordKey}`,
			);
		}
	}
	return resolved;
}

function itemConflictSet() {
	const set: Record<string, unknown> = {
		deleted: sql.raw(`excluded."deleted"`),
		deletedAt: sql.raw(`excluded."deletedAt"`),
		parentItem: sql.raw(`excluded."parentItem"`),
		revision: sql`${item.revision} + 1`,
		updatedAt: sql.raw(`excluded."updatedAt"`),
	};
	for (const field of sourceWritableItemFields) {
		const column = itemColumns[field as keyof typeof itemColumns];
		set[field] = sql.raw(`excluded."${column.name}"`);
	}
	return set;
}

async function writeCollectionRows(
	transaction: Transaction,
	rows: CollectionInsert[],
) {
	const written: Array<{ key: string; revision: number }> = [];
	for (const rowChunk of chunkValues(
		rows,
		COLLECTION_UPSERT_CHUNK_SIZE,
	)) {
		written.push(
			...(await transaction
				.insert(collection)
				.values(rowChunk)
				.onConflictDoUpdate({
					target: collection.key,
					set: {
						deleted: sql.raw(`excluded."deleted"`),
						deletedAt: sql.raw(`excluded."deletedAt"`),
						name: sql.raw(`excluded."name"`),
						numCollections: sql.raw(
							`excluded."numCollections"`,
						),
						numItems: sql.raw(`excluded."numItems"`),
						parentCollection: sql.raw(
							`excluded."parentCollection"`,
						),
						relations: sql.raw(`excluded."relations"`),
						revision: sql`${collection.revision} + 1`,
						updatedAt: sql.raw(`excluded."updatedAt"`),
					},
				})
				.returning({
					key: collection.key,
					revision: collection.revision,
				})),
		);
	}
	return written;
}

async function writeItemRows(
	transaction: Transaction,
	rows: ItemInsert[],
) {
	const written: Array<{ key: string; revision: number }> = [];
	for (const rowChunk of chunkValues(rows, ITEM_UPSERT_CHUNK_SIZE)) {
		written.push(
			...(await transaction
				.insert(item)
				.values(rowChunk)
				.onConflictDoUpdate({
					target: item.key,
					set: itemConflictSet(),
				})
				.returning({
					key: item.key,
					revision: item.revision,
				})),
		);
	}
	return written;
}

async function insertInChunks<T>(
	rows: T[],
	size: number,
	insert: (rowChunk: T[]) => Promise<unknown>,
) {
	for (const rowChunk of chunkValues(rows, size)) {
		await insert(rowChunk);
	}
}

async function updateItemParents(
	transaction: Transaction,
	rows: Array<{ key: string; parentKey: string | null }>,
) {
	for (const rowChunk of chunkValues(rows, RELATION_CHUNK_SIZE)) {
		const cases = sql.join(
			rowChunk.map(
				(row) =>
					sql`WHEN ${row.key} THEN ${row.parentKey}`,
			),
			sql` `,
		);
		const keys = sql.join(
			rowChunk.map((row) => sql`${row.key}`),
			sql`, `,
		);
		await transaction.execute(sql`
			UPDATE "item"
			SET "parentItem" = CASE "key" ${cases} END
			WHERE "key" IN (${keys})
		`);
	}
}

async function updateCollectionParents(
	transaction: Transaction,
	rows: Array<{ key: string; parentKey: string | null }>,
) {
	for (const rowChunk of chunkValues(rows, RELATION_CHUNK_SIZE)) {
		const cases = sql.join(
			rowChunk.map(
				(row) =>
					sql`WHEN ${row.key} THEN ${row.parentKey}`,
			),
			sql` `,
		);
		const keys = sql.join(
			rowChunk.map((row) => sql`${row.key}`),
			sql`, `,
		);
		await transaction.execute(sql`
			UPDATE "collection"
			SET "parentCollection" = CASE "key" ${cases} END
			WHERE "key" IN (${keys})
		`);
	}
}

async function assertAcyclicItemParents(
	transaction: Transaction,
	itemKeys: string[],
) {
	if (itemKeys.length === 0) return;
	const keyList = sql.join(
		itemKeys.map((key) => sql`${key}`),
		sql`, `,
	);
	const result = await transaction.execute<{ origin: string }>(sql`
		WITH RECURSIVE ancestry AS (
			SELECT
				current."key" AS origin,
				current."key",
				current."parentItem" AS parent,
				ARRAY[current."key"]::varchar[] AS path,
				false AS cycle
			FROM "item" current
			WHERE current."key" IN (${keyList})
			UNION ALL
			SELECT
				ancestry.origin,
				parent."key",
				parent."parentItem",
				ancestry.path || parent."key",
				parent."key" = ANY(ancestry.path)
			FROM ancestry
			JOIN "item" parent ON parent."key" = ancestry.parent
			WHERE NOT ancestry.cycle
		)
		SELECT origin FROM ancestry WHERE cycle LIMIT 1
	`);
	if (result.rows.length > 0) {
		throw new SourceRelationshipCycleError("item");
	}
}

async function assertAcyclicCollectionParents(
	transaction: Transaction,
	collectionKeys: string[],
) {
	if (collectionKeys.length === 0) return;
	const keyList = sql.join(
		collectionKeys.map((key) => sql`${key}`),
		sql`, `,
	);
	const result = await transaction.execute<{ origin: string }>(sql`
		WITH RECURSIVE ancestry AS (
			SELECT
				current."key" AS origin,
				current."key",
				current."parentCollection" AS parent,
				ARRAY[current."key"]::varchar[] AS path,
				false AS cycle
			FROM "collection" current
			WHERE current."key" IN (${keyList})
			UNION ALL
			SELECT
				ancestry.origin,
				parent."key",
				parent."parentCollection",
				ancestry.path || parent."key",
				parent."key" = ANY(ancestry.path)
			FROM ancestry
			JOIN "collection" parent ON parent."key" = ancestry.parent
			WHERE NOT ancestry.cycle
		)
		SELECT origin FROM ancestry WHERE cycle LIMIT 1
	`);
	if (result.rows.length > 0) {
		throw new SourceRelationshipCycleError("collection");
	}
}

export async function writeSourceIngestionBatch(
	db: Database,
	input: unknown,
) {
	const parsed = sourceIngestionBatchSchema.safeParse(input);
	if (!parsed.success) {
		throw new SourceIngestionValidationError(
			parsed.error.issues
				.map(
					(issue) =>
						`${issue.path.join(".") || "batch"}: ${issue.message}`,
				)
				.join("; "),
		);
	}
	const batch = parsed.data;

	const itemUpserts = batch.items.filter(
		(record) => record.operation === "upsert",
	);
	const itemDeletes = batch.items.filter(
		(record) => record.operation === "delete",
	);
	const collectionUpserts = batch.collections.filter(
		(record) => record.operation === "upsert",
	);
	const collectionDeletes = batch.collections.filter(
		(record) => record.operation === "delete",
	);
	const normalizedItems = new Map(
		itemUpserts.map((record) => [
			record.sourceRecordKey,
			sourceItemValues(record, batch.fetchedAt),
		]),
	);

	return db.transaction(async (transaction) => {
		const involvedConnectionKeys = [
			...new Set([
				batch.sourceConnectionKey,
				...itemUpserts.flatMap((record) =>
					record.collections.flatMap((reference) =>
						reference.sourceConnectionKey
							? [reference.sourceConnectionKey]
							: [],
					),
				),
			]),
		].sort();
		const lockedConnections = await transaction
			.select()
			.from(sourceConnection)
			.where(inArray(sourceConnection.key, involvedConnectionKeys))
			.orderBy(sourceConnection.key)
			.for("update");
		const connection = lockedConnections.find(
			(candidate) => candidate.key === batch.sourceConnectionKey,
		);
		if (
			!connection ||
			connection.provider === "native" ||
			connection.status !== "active"
		) {
			throw new SourceConnectionUnavailableError(
				batch.sourceConnectionKey,
			);
		}
		if (lockedConnections.length !== involvedConnectionKeys.length) {
			throw new SourceReferenceNotFoundError(
				"collection",
				"source connection",
			);
		}
		if (
			!jsonEqual(
				connection.syncCursor as JsonValue,
				batch.expectedCursor as JsonValue,
			)
		) {
			throw new SourceCursorConflictError(batch.sourceConnectionKey);
		}

		const collectionKeys = await reserveCollectionIdentities(
			transaction,
			{
				sourceConnectionKey: batch.sourceConnectionKey,
				sourceRecordKeys: collectionUpserts.map(
					(record) => record.sourceRecordKey,
				),
			},
		);
		const itemKeys = await reserveItemIdentities(transaction, {
			sourceConnectionKey: batch.sourceConnectionKey,
			sourceRecordKeys: itemUpserts.map(
				(record) => record.sourceRecordKey,
			),
		});

		for (const [sourceRecordKey, key] of await loadIdentityMap(
			transaction,
			"collection",
			batch.sourceConnectionKey,
			[
				...collectionDeletes.map(
					(record) => record.sourceRecordKey,
				),
				...collectionUpserts.flatMap((record) =>
					record.parentSourceRecordKey
						? [record.parentSourceRecordKey]
						: [],
				),
			],
		)) {
			collectionKeys.set(sourceRecordKey, key);
		}
		for (const [sourceRecordKey, key] of await loadIdentityMap(
			transaction,
			"item",
			batch.sourceConnectionKey,
			[
				...itemDeletes.map((record) => record.sourceRecordKey),
				...itemUpserts.flatMap((record) =>
					record.parentSourceRecordKey
						? [record.parentSourceRecordKey]
						: [],
				),
			],
		)) {
			itemKeys.set(sourceRecordKey, key);
		}

		const allItemKeys = [...new Set(itemKeys.values())];
		const allCollectionKeys = [...new Set(collectionKeys.values())];
		const existingItems =
			allItemKeys.length === 0
				? []
				: await transaction
						.select({
							deleted: item.deleted,
							key: item.key,
							parentItem: item.parentItem,
						})
						.from(item)
						.where(inArray(item.key, allItemKeys))
						.orderBy(item.key)
						.for("update");
		const existingCollections =
			allCollectionKeys.length === 0
				? []
				: await transaction
						.select({
							deleted: collection.deleted,
							key: collection.key,
							name: collection.name,
							numCollections: collection.numCollections,
							numItems: collection.numItems,
							parentCollection:
								collection.parentCollection,
							relations: collection.relations,
						})
						.from(collection)
						.where(inArray(collection.key, allCollectionKeys))
						.orderBy(collection.key)
						.for("update");
		const existingItemByKey = new Map(
			existingItems.map((row) => [row.key, row]),
		);
		const existingCollectionByKey = new Map(
			existingCollections.map((row) => [row.key, row]),
		);
		const snapshots =
			allItemKeys.length === 0
				? []
				: await transaction
						.select()
						.from(sourceSnapshot)
						.where(inArray(sourceSnapshot.itemKey, allItemKeys));
		const snapshotByItemKey = new Map(
			snapshots.map((row) => [row.itemKey, row]),
		);

		const parentItemKeys = new Map<string, string | null>();
		for (const record of itemUpserts) {
			if (!record.parentSourceRecordKey) {
				parentItemKeys.set(record.sourceRecordKey, null);
				continue;
			}
			const parentKey = itemKeys.get(record.parentSourceRecordKey);
			if (!parentKey) {
				throw new SourceReferenceNotFoundError(
					"item",
					`${batch.sourceConnectionKey}/${record.parentSourceRecordKey}`,
				);
			}
			parentItemKeys.set(record.sourceRecordKey, parentKey);
		}

		const parentCollectionKeys = new Map<string, string | null>();
		for (const record of collectionUpserts) {
			if (!record.parentSourceRecordKey) {
				parentCollectionKeys.set(record.sourceRecordKey, null);
				continue;
			}
			const parentKey = collectionKeys.get(
				record.parentSourceRecordKey,
			);
			if (!parentKey) {
				throw new SourceReferenceNotFoundError(
					"collection",
					`${batch.sourceConnectionKey}/${record.parentSourceRecordKey}`,
				);
			}
			parentCollectionKeys.set(record.sourceRecordKey, parentKey);
		}

		const allCollectionReferences = itemUpserts.flatMap(
			(record) => record.collections,
		);
		const resolvedCollectionReferences =
			await resolveCollectionReferences(
				transaction,
				batch.sourceConnectionKey,
				allCollectionReferences,
				collectionKeys,
			);

		const now = new Date();
		const collectionEvents = new Map<
			string,
			{ operation: "delete" | "upsert"; revision: number }
		>();
		const changedCollectionUpserts = collectionUpserts.filter(
			(record) => {
				const key = collectionKeys.get(record.sourceRecordKey)!;
				const existing = existingCollectionByKey.get(key);
				const parentKey =
					parentCollectionKeys.get(record.sourceRecordKey) ?? null;
				return (
					!existing ||
					existing.deleted === 1 ||
					existing.name !== record.data.name ||
					existing.numCollections !==
						record.data.numCollections ||
					existing.numItems !== record.data.numItems ||
					existing.parentCollection !== parentKey ||
					!nullableJsonEqual(
						existing.relations as Record<string, unknown> | null,
						record.data.relations,
					)
				);
			},
		);
		const writtenCollections = await writeCollectionRows(
			transaction,
			changedCollectionUpserts.map((record) => ({
				key: collectionKeys.get(record.sourceRecordKey)!,
				sourceConnectionKey: batch.sourceConnectionKey,
				sourceRecordKey: record.sourceRecordKey,
				revision: 1,
				name: record.data.name,
				numCollections: record.data.numCollections,
				numItems: record.data.numItems,
				relations: record.data.relations,
				parentCollection: null,
				deleted: 0,
				deletedAt: null,
				updatedAt: now,
			})),
		);
		for (const row of writtenCollections) {
			collectionEvents.set(row.key, {
				operation: "upsert",
				revision: row.revision,
			});
		}
		const collectionDeleteKeys = collectionDeletes.flatMap((record) => {
			const key = collectionKeys.get(record.sourceRecordKey);
			const existing = key
				? existingCollectionByKey.get(key)
				: undefined;
			return key && existing && existing.deleted !== 1 ? [key] : [];
		});
		const collectionDeleteKeySet = new Set(collectionDeleteKeys);
		const activeParentCollectionKeys = [
			...new Set(
				changedCollectionUpserts.flatMap((record) => {
					const parentKey =
						parentCollectionKeys.get(
							record.sourceRecordKey,
						) ?? null;
					return parentKey ? [parentKey] : [];
				}),
			),
		];
		if (
			activeParentCollectionKeys.some((key) =>
				collectionDeleteKeySet.has(key),
			)
		) {
			throw new SourceReferenceNotFoundError(
				"collection",
				"parent deleted in this batch",
			);
		}
		if (activeParentCollectionKeys.length > 0) {
			const activeParents = await transaction
				.select({ key: collection.key })
				.from(collection)
				.where(
					and(
						inArray(
							collection.key,
							activeParentCollectionKeys,
						),
						eq(collection.deleted, 0),
					),
				);
			if (
				activeParents.length !==
				activeParentCollectionKeys.length
			) {
				throw new SourceReferenceNotFoundError(
					"collection",
					"active parent",
				);
			}
		}
		await updateCollectionParents(
			transaction,
			changedCollectionUpserts.map((record) => ({
				key: collectionKeys.get(record.sourceRecordKey)!,
				parentKey:
					parentCollectionKeys.get(record.sourceRecordKey) ??
					null,
			})),
		);

		if (collectionDeleteKeys.length > 0) {
			const deletedCollections = await transaction
				.update(collection)
				.set({
					deleted: 1,
					deletedAt: now,
					revision: sql`${collection.revision} + 1`,
					updatedAt: now,
				})
				.where(inArray(collection.key, collectionDeleteKeys))
				.returning({
					key: collection.key,
					revision: collection.revision,
				});
			for (const row of deletedCollections) {
				collectionEvents.set(row.key, {
					operation: "delete",
					revision: row.revision,
				});
			}
		}
		await assertAcyclicCollectionParents(
			transaction,
			changedCollectionUpserts.map(
				(record) => collectionKeys.get(record.sourceRecordKey)!,
			),
		);

		const changedItemUpserts = itemUpserts.filter((record) => {
			const key = itemKeys.get(record.sourceRecordKey)!;
			const existing = existingItemByKey.get(key);
			const snapshot = snapshotByItemKey.get(key);
			return (
				!existing ||
				existing.deleted === 1 ||
				!snapshot ||
				snapshot.payloadHash !== sourceItemFingerprint(record) ||
				snapshot.remoteVersion !== record.remoteVersion ||
				snapshot.mappingProfileVersion !==
					batch.mappingProfileVersion
			);
		});
		const itemEvents = new Map<
			string,
			{ operation: "delete" | "upsert"; revision: number }
		>();
		const writtenItems = await writeItemRows(
			transaction,
			changedItemUpserts.map((record) => ({
				...normalizedItems.get(record.sourceRecordKey)!.item,
				key: itemKeys.get(record.sourceRecordKey)!,
				sourceConnectionKey: batch.sourceConnectionKey,
				sourceRecordKey: record.sourceRecordKey,
				parentItem: null,
				revision: 1,
				deleted: 0,
				deletedAt: null,
				updatedAt: now,
			})),
		);
		for (const row of writtenItems) {
			itemEvents.set(row.key, {
				operation: "upsert",
				revision: row.revision,
			});
		}
		const itemDeleteKeys = itemDeletes.flatMap((record) => {
			const key = itemKeys.get(record.sourceRecordKey);
			const existing = key ? existingItemByKey.get(key) : undefined;
			return key && existing && existing.deleted !== 1 ? [key] : [];
		});
		const itemDeleteKeySet = new Set(itemDeleteKeys);
		const activeParentItemKeys = [
			...new Set(
				changedItemUpserts.flatMap((record) => {
					const parentKey =
						parentItemKeys.get(record.sourceRecordKey) ??
						null;
					return parentKey ? [parentKey] : [];
				}),
			),
		];
		if (
			activeParentItemKeys.some((key) =>
				itemDeleteKeySet.has(key),
			)
		) {
			throw new SourceReferenceNotFoundError(
				"item",
				"parent deleted in this batch",
			);
		}
		if (activeParentItemKeys.length > 0) {
			const activeParents = await transaction
				.select({ key: item.key })
				.from(item)
				.where(
					and(
						inArray(item.key, activeParentItemKeys),
						eq(item.deleted, 0),
					),
				);
			if (activeParents.length !== activeParentItemKeys.length) {
				throw new SourceReferenceNotFoundError(
					"item",
					"active parent",
				);
			}
		}
		await updateItemParents(
			transaction,
			changedItemUpserts.map((record) => ({
				key: itemKeys.get(record.sourceRecordKey)!,
				parentKey:
					parentItemKeys.get(record.sourceRecordKey) ?? null,
			})),
		);

		if (itemDeleteKeys.length > 0) {
			const deletedItems = await transaction
				.update(item)
				.set({
					deleted: 1,
					deletedAt: now,
					revision: sql`${item.revision} + 1`,
					updatedAt: now,
				})
				.where(inArray(item.key, itemDeleteKeys))
				.returning({
					key: item.key,
					revision: item.revision,
				});
			for (const row of deletedItems) {
				itemEvents.set(row.key, {
					operation: "delete",
					revision: row.revision,
				});
			}
		}
		await assertAcyclicItemParents(
			transaction,
			changedItemUpserts.map(
				(record) => itemKeys.get(record.sourceRecordKey)!,
			),
		);

		const changedItemKeys = changedItemUpserts.map(
			(record) => itemKeys.get(record.sourceRecordKey)!,
		);
		if (changedItemKeys.length > 0) {
			await transaction
				.delete(itemToTag)
				.where(inArray(itemToTag.itemKey, changedItemKeys));
			await transaction
				.delete(itemToCollection)
				.where(inArray(itemToCollection.itemKey, changedItemKeys));
		}

		const tagRows = changedItemUpserts.flatMap((record) =>
			normalizedItems
				.get(record.sourceRecordKey)!
				.tags.map((name) => ({ name })),
		);
		await insertInChunks(
			[...new Map(tagRows.map((row) => [row.name, row])).values()],
			RELATION_CHUNK_SIZE,
			(rowChunk) =>
				transaction
					.insert(tag)
					.values(rowChunk)
					.onConflictDoNothing(),
		);
		const itemTagRows = changedItemUpserts.flatMap((record) =>
			normalizedItems
				.get(record.sourceRecordKey)!
				.tags.map((tagName) => ({
					itemKey: itemKeys.get(record.sourceRecordKey)!,
					tagName,
				})),
		);
		await insertInChunks(
			itemTagRows,
			RELATION_CHUNK_SIZE,
			(rowChunk) => transaction.insert(itemToTag).values(rowChunk),
		);

		const itemCollectionRows = changedItemUpserts.flatMap((record) =>
			normalizedItems
				.get(record.sourceRecordKey)!
				.collectionReferences.map((reference) => {
					const connectionKey =
						reference.sourceConnectionKey ??
						batch.sourceConnectionKey;
					return {
						itemKey: itemKeys.get(record.sourceRecordKey)!,
						collectionKey:
							resolvedCollectionReferences.get(
								`${connectionKey}\u0000${reference.sourceRecordKey}`,
							)!,
					};
				}),
		);
		const activeCollectionKeys = [
			...new Set(
				itemCollectionRows.map((row) => row.collectionKey),
			),
		];
		if (activeCollectionKeys.length > 0) {
			const activeCollections = await transaction
				.select({ key: collection.key })
				.from(collection)
				.where(
					and(
						inArray(collection.key, activeCollectionKeys),
						eq(collection.deleted, 0),
					),
				);
			if (
				activeCollections.length !== activeCollectionKeys.length
			) {
				throw new SourceReferenceNotFoundError(
					"collection",
					"active relationship",
				);
			}
		}
		await insertInChunks(
			itemCollectionRows,
			RELATION_CHUNK_SIZE,
			(rowChunk) =>
				transaction.insert(itemToCollection).values(rowChunk),
		);

		const aliasRows = itemUpserts.flatMap((record) =>
			record.aliases.map((alias) => ({
				sourceConnectionKey: batch.sourceConnectionKey,
				aliasKey: alias.key,
				itemKey: itemKeys.get(record.sourceRecordKey)!,
				kind: alias.kind,
			})),
		);
		if (aliasRows.length > 0) {
			const aliasKeys = aliasRows.map((row) => row.aliasKey);
			const existingAliases = await transaction
				.select()
				.from(sourceRecordAlias)
				.where(
					and(
						eq(
							sourceRecordAlias.sourceConnectionKey,
							batch.sourceConnectionKey,
						),
						inArray(sourceRecordAlias.aliasKey, aliasKeys),
					),
				);
			const expectedByAlias = new Map(
				aliasRows.map((row) => [row.aliasKey, row.itemKey]),
			);
			const conflict = existingAliases.find(
				(row) =>
					expectedByAlias.get(row.aliasKey) !== row.itemKey,
			);
			if (conflict) {
				throw new SourceAliasConflictError(conflict.aliasKey);
			}
			await insertInChunks(
				aliasRows,
				RELATION_CHUNK_SIZE,
				(rowChunk) =>
					transaction
						.insert(sourceRecordAlias)
						.values(rowChunk)
						.onConflictDoNothing(),
			);
		}

		const snapshotRows = batch.items.flatMap((record) => {
			const itemKey = itemKeys.get(record.sourceRecordKey);
			if (!itemKey) return [];
			const expectedHash =
				record.operation === "upsert"
					? sourceItemFingerprint(record)
					: sourcePayloadHash(record.raw);
			const existingSnapshot = snapshotByItemKey.get(itemKey);
			if (
				existingSnapshot?.payloadHash === expectedHash &&
				existingSnapshot.remoteVersion ===
					record.remoteVersion &&
				existingSnapshot.mappingProfileVersion ===
					batch.mappingProfileVersion
			) {
				return [];
			}
			return [
				{
					itemKey,
					payload: record.raw,
					payloadHash: expectedHash,
					remoteVersion: record.remoteVersion,
					mappingProfileVersion:
						batch.mappingProfileVersion,
					fetchedAt: batch.fetchedAt,
				},
			];
		});
		const replacedSnapshotKeys = new Set(
			snapshotRows.map((row) => row.itemKey),
		);
		const refreshedSnapshotKeys = batch.items.flatMap((record) => {
			const itemKey = itemKeys.get(record.sourceRecordKey);
			return itemKey && !replacedSnapshotKeys.has(itemKey)
				? [itemKey]
				: [];
		});
		await insertInChunks(
			snapshotRows,
			RELATION_CHUNK_SIZE,
			(rowChunk) =>
				transaction
					.insert(sourceSnapshot)
					.values(rowChunk)
					.onConflictDoUpdate({
						target: sourceSnapshot.itemKey,
						set: {
							payload: sql.raw(`excluded."payload"`),
							payloadHash: sql.raw(
								`excluded."payloadHash"`,
							),
							remoteVersion: sql.raw(
								`excluded."remoteVersion"`,
							),
							mappingProfileVersion: sql.raw(
								`excluded."mappingProfileVersion"`,
							),
							fetchedAt: sql.raw(`excluded."fetchedAt"`),
						},
					}),
		);
		await insertInChunks(
			refreshedSnapshotKeys,
			RELATION_CHUNK_SIZE,
			(keyChunk) =>
				transaction
					.update(sourceSnapshot)
					.set({ fetchedAt: batch.fetchedAt })
					.where(inArray(sourceSnapshot.itemKey, keyChunk)),
		);

		const directlyChangedItemKeys = new Set(itemEvents.keys());
		const affectedParentKeys = new Set<string>();
		for (const record of changedItemUpserts) {
			const key = itemKeys.get(record.sourceRecordKey)!;
			const oldParent = existingItemByKey.get(key)?.parentItem;
			const newParent =
				parentItemKeys.get(record.sourceRecordKey) ?? null;
			if (oldParent) affectedParentKeys.add(oldParent);
			if (newParent) affectedParentKeys.add(newParent);
		}
		for (const key of itemDeleteKeys) {
			const oldParent = existingItemByKey.get(key)?.parentItem;
			if (oldParent) affectedParentKeys.add(oldParent);
		}
		const parentKeysToBump = [...affectedParentKeys]
			.filter((key) => !directlyChangedItemKeys.has(key))
			.sort();
		if (parentKeysToBump.length > 0) {
			const bumpedParents = await transaction
				.update(item)
				.set({
					revision: sql`${item.revision} + 1`,
					updatedAt: now,
				})
				.where(
					and(
						inArray(item.key, parentKeysToBump),
						eq(item.deleted, 0),
					),
				)
				.returning({
					key: item.key,
					revision: item.revision,
				});
			for (const parent of bumpedParents) {
				itemEvents.set(parent.key, {
					operation: "upsert",
					revision: parent.revision,
				});
			}
		}

		const outboxRows = [
			...[...collectionEvents].map(
				([entityKey, { operation, revision }]) => ({
					entityType: "collection" as const,
					entityKey,
					operation,
					revision,
				}),
			),
			...[...itemEvents].map(
				([entityKey, { operation, revision }]) => ({
					entityType: "item" as const,
					entityKey,
					operation,
					revision,
				}),
			),
		];
		await insertInChunks(
			outboxRows,
			RELATION_CHUNK_SIZE,
			(rowChunk) => transaction.insert(outbox).values(rowChunk),
		);

		await transaction
			.update(sourceConnection)
			.set({
				syncCursor: batch.nextCursor,
				updatedAt: now,
			})
			.where(eq(sourceConnection.key, batch.sourceConnectionKey));

		return {
			collectionKeys: Object.fromEntries(collectionKeys),
			cursor: batch.nextCursor,
			itemKeys: Object.fromEntries(itemKeys),
			written: {
				collections: collectionEvents.size,
				items: itemEvents.size,
				outboxEvents: outboxRows.length,
			},
		};
	});
}
