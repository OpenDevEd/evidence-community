import { LIBRARY_OWNED_PAYLOAD_FIELDS } from "@/lib/admin/item-fields";
import { preserveCreatorProfileLinks } from "@/lib/admin/creator-profile-links";
import {
	collectionIdentity,
	collectionSourceLink,
	collectionSourceSnapshot,
	itemSourceLink,
	outbox,
	sourceConnection,
	sourceFileCleanup,
	sourceRecordIssue,
} from "@opendeved/evidence-library-core";
import {
	and,
	eq,
	getTableColumns,
	inArray,
	notExists,
	sql,
	type InferInsertModel,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "@/db/database-schema";
import {
	lockCollectionMutations,
	lockItemMutations,
} from "@/db/canonical-mutation-lock";
import {
	reserveCollectionIdentities,
	reserveItemSourceLinks,
} from "@/db/record-identity";
import {
	itemFilePublication,
	sourceRecordAlias,
	sourceSnapshot,
} from "@/db/schema/source";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemCitationMetric } from "@/db/schema/tables/itemCitationMetric";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { replaceSourceLinks } from "@/lib/links/item-links";

import { parseZoteroItemUri } from "./zotero/uri";
import { tag } from "@/db/schema/tables/tag";
import {
	NativeItemValidationError,
	sourceRecordValidationOptions,
	validateNativeItemDraft,
} from "@/lib/admin/native-item-validation";
import { enqueuePublicationJobsForItem } from "@/lib/publication/queue";

import {
	type JsonValue,
	type SourceIngestionBatch,
	sourceIngestionBatchSchema,
} from "./batch-schema";
import { chunkValues } from "@/lib/chunk-values";
import {
	canonicalSourceJson,
	sourceCollectionFingerprint,
	sourceItemFingerprint,
	sourcePayloadHash,
} from "./fingerprint";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ItemInsert = InferInsertModel<typeof item>;
type CollectionInsert = InferInsertModel<typeof collection>;

const ITEM_UPSERT_CHUNK_SIZE = 200;
const RELATION_CHUNK_SIZE = 1_000;
const COLLECTION_UPSERT_CHUNK_SIZE = 1_000;

const itemColumns = getTableColumns(item);
const sourceWritableItemFields = Object.keys(itemColumns).filter(
	(field) =>
		!LIBRARY_OWNED_PAYLOAD_FIELDS.has(field) && !new Set([
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
const fileManagedItemFields = [
	"url",
	"contentType",
	"filename",
	"linkMode",
	"md5",
	"mtime",
	"charset",
	"fullTextPDF",
	"PDFCoverPageImage",
	"PDFCoverPageWidth",
	"PDFCoverPageHeight",
] as const satisfies readonly (keyof ItemInsert)[];

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

export class SourceFileStagingConflictError extends Error {
	constructor(sourceConnectionKey: string, objectPaths: readonly string[]) {
		super(
			`Source file staging was lost for ${sourceConnectionKey}: ${objectPaths.join(", ")}`,
		);
		this.name = "SourceFileStagingConflictError";
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
		validated = validateNativeItemDraft(
			record.metadata,
			sourceRecordValidationOptions,
		);
	} catch (error) {
		if (error instanceof NativeItemValidationError) {
			throw new SourceIngestionValidationError(
				`Source record ${record.sourceRecordKey}: ${error.message}`,
			);
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
	values.dateModified = record.sourceDates?.modifiedAt ?? null;

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

function databaseValueEqual(left: unknown, right: unknown) {
	if (left instanceof Date || right instanceof Date) {
		return (
			left instanceof Date &&
			right instanceof Date &&
			left.getTime() === right.getTime()
		);
	}
	if (
		left !== null &&
		right !== null &&
		typeof left === "object" &&
		typeof right === "object"
	) {
		return (
			canonicalSourceJson(left as JsonValue) ===
			canonicalSourceJson(right as JsonValue)
		);
	}
	return left === right;
}

function stringSetEqual(left: readonly string[], right: readonly string[]) {
	if (left.length !== right.length) return false;
	const rightSet = new Set(right);
	return left.every((value) => rightSet.has(value));
}

function maskDirtyItemFields(
	incoming: Partial<ItemInsert>,
	existing: typeof item.$inferSelect | undefined,
	dirtyFields: ReadonlySet<string>,
) {
	if (!existing || dirtyFields.size === 0) return incoming;
	const masked = { ...incoming } as Record<string, unknown>;
	const existingValues = existing as unknown as Record<string, unknown>;
	for (const field of sourceWritableItemFields) {
		if (dirtyFields.has(field)) {
			masked[field] = existingValues[field];
		}
	}
	return masked as Partial<ItemInsert>;
}

function sourceOwnsCanonicalItem(
	existing: typeof item.$inferSelect | undefined,
	sourceConnectionKey: string,
) {
	return !existing || existing.sourceConnectionKey === sourceConnectionKey;
}

function preserveForeignOwnedFileFields(
	incoming: Partial<ItemInsert>,
	existing: typeof item.$inferSelect | undefined,
	sourceConnectionKey: string,
	hasManagedPublication: boolean,
) {
	if (!existing || sourceOwnsCanonicalItem(existing, sourceConnectionKey)) {
		return incoming;
	}
	const preserved = { ...incoming } as Record<string, unknown>;
	const existingValues = existing as unknown as Record<string, unknown>;
	for (const field of fileManagedItemFields) {
		preserved[field] = existingValues[field];
	}
	if (hasManagedPublication) preserved.itemType = existing.itemType;
	return preserved as Partial<ItemInsert>;
}

function itemValuesDiffer(
	existing: typeof item.$inferSelect | undefined,
	next: Partial<ItemInsert>,
) {
	if (!existing) return true;
	const existingValues = existing as unknown as Record<string, unknown>;
	const nextValues = next as Record<string, unknown>;
	return sourceWritableItemFields.some(
		(field) =>
			!databaseValueEqual(existingValues[field], nextValues[field]),
	);
}

async function loadIdentityMap(
	transaction: Transaction,
	entity: "collection" | "item",
	sourceConnectionKey: string,
	sourceRecordKeys: string[],
) {
	if (sourceRecordKeys.length === 0) return new Map<string, string>();
	const rows =
		entity === "item"
			? await transaction
					.select({
						key: itemSourceLink.itemKey,
						sourceRecordKey: itemSourceLink.sourceRecordKey,
					})
					.from(itemSourceLink)
					.where(
						and(
							eq(
								itemSourceLink.sourceConnectionKey,
								sourceConnectionKey,
							),
							inArray(
								itemSourceLink.sourceRecordKey,
								sourceRecordKeys,
							),
						),
					)
			: await transaction
					.select({
						key: collectionIdentity.key,
						sourceRecordKey: collectionIdentity.sourceRecordKey,
					})
					.from(collectionIdentity)
					.where(
						and(
							eq(
								collectionIdentity.sourceConnectionKey,
								sourceConnectionKey,
							),
							inArray(
								collectionIdentity.sourceRecordKey,
								sourceRecordKeys,
							),
						),
					);
	return new Map(
		rows.map(({ key, sourceRecordKey }) => [sourceRecordKey, key]),
	);
}

function relationUris(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((entry): entry is string => typeof entry === "string");
	}
	return typeof value === "string" ? [value] : [];
}

/** A Zotero item URI resolves only inside the library this connection reads. */
function uriBelongsToConnection(
	reference: { libraryId: string; libraryType: "group" | "user" },
	connection: { externalScopeKey: string | null; scopeKind: string },
) {
	if (!connection.externalScopeKey) return false;
	const expectedType =
		connection.scopeKind === "group" ? "group" : "user";
	return (
		reference.libraryType === expectedType &&
		reference.libraryId === connection.externalScopeKey
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
					eq(collectionIdentity.sourceConnectionKey, connectionKey),
					inArray(collectionIdentity.sourceRecordKey, [
						...sourceRecordKeys,
					]),
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
	for (const rowChunk of chunkValues(rows, COLLECTION_UPSERT_CHUNK_SIZE)) {
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
						numCollections: sql.raw(`excluded."numCollections"`),
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

async function writeItemRows(transaction: Transaction, rows: ItemInsert[]) {
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
			rowChunk.map((row) => sql`WHEN ${row.key} THEN ${row.parentKey}`),
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
			rowChunk.map((row) => sql`WHEN ${row.key} THEN ${row.parentKey}`),
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

async function updateItemSourceLinkVersions(
	transaction: Transaction,
	sourceConnectionKey: string,
	rows: Array<{
		acknowledged: boolean;
		itemKey: string;
		remoteDeleted: boolean;
		remoteVersion: string | null;
	}>,
	updatedAt: Date,
) {
	for (const rowChunk of chunkValues(rows, RELATION_CHUNK_SIZE)) {
		const values = sql.join(
			rowChunk.map(
				(row) =>
					sql`(${row.itemKey}, ${row.remoteVersion}::varchar, ${row.remoteDeleted}::boolean, ${row.acknowledged}::boolean)`,
			),
			sql`, `,
		);
		await transaction.execute(sql`
			UPDATE "itemSourceLink" AS link
			SET
				"remoteVersion" = incoming."remoteVersion",
				"remoteDeleted" = incoming."remoteDeleted",
				"lastAcknowledgedRemoteVersion" = CASE
					WHEN incoming."acknowledged" THEN incoming."remoteVersion"
					ELSE link."lastAcknowledgedRemoteVersion"
				END,
				"updatedAt" = ${updatedAt}
			FROM (VALUES ${values}) AS incoming(
				"itemKey",
				"remoteVersion",
				"remoteDeleted",
				"acknowledged"
			)
			WHERE link."sourceConnectionKey" = ${sourceConnectionKey}
				AND link."itemKey" = incoming."itemKey"
		`);
	}
}

async function ensureCollectionSourceLinks(
	transaction: Transaction,
	sourceConnectionKey: string,
	rows: Array<{ collectionKey: string; sourceRecordKey: string }>,
) {
	if (rows.length === 0) return;
	const inserted = await transaction
		.insert(collectionSourceLink)
		.values(
			rows.map((row) => ({
				...row,
				sourceConnectionKey,
			})),
		)
		.onConflictDoNothing()
		.returning({ collectionKey: collectionSourceLink.collectionKey });
	const insertedKeys = inserted.map((row) => row.collectionKey);
	if (insertedKeys.length === 0) return;

	const enabledLink = alias(
		collectionSourceLink,
		"enabledCollectionSourceLink",
	);
	await transaction
		.update(collectionSourceLink)
		.set({ writebackEnabled: true })
		.where(
			and(
				inArray(collectionSourceLink.collectionKey, insertedKeys),
				eq(
					collectionSourceLink.sourceConnectionKey,
					sourceConnectionKey,
				),
				notExists(
					transaction
						.select({ collectionKey: enabledLink.collectionKey })
						.from(enabledLink)
						.where(
							and(
								eq(
									enabledLink.collectionKey,
									collectionSourceLink.collectionKey,
								),
								eq(enabledLink.writebackEnabled, true),
							),
						),
				),
			),
		);
}

async function updateCollectionSourceLinkVersions(
	transaction: Transaction,
	sourceConnectionKey: string,
	rows: Array<{
		acknowledged: boolean;
		collectionKey: string;
		remoteDeleted: boolean;
		remoteVersion: string | null;
	}>,
	updatedAt: Date,
) {
	for (const rowChunk of chunkValues(rows, RELATION_CHUNK_SIZE)) {
		const values = sql.join(
			rowChunk.map(
				(row) =>
					sql`(${row.collectionKey}, ${row.remoteVersion}::varchar, ${row.remoteDeleted}::boolean, ${row.acknowledged}::boolean)`,
			),
			sql`, `,
		);
		await transaction.execute(sql`
			UPDATE "collectionSourceLink" AS link
			SET
				"remoteVersion" = incoming."remoteVersion",
				"remoteDeleted" = incoming."remoteDeleted",
				"lastAcknowledgedRemoteVersion" = CASE
					WHEN incoming."acknowledged" THEN incoming."remoteVersion"
					ELSE link."lastAcknowledgedRemoteVersion"
				END,
				"updatedAt" = ${updatedAt}
			FROM (VALUES ${values}) AS incoming(
				"collectionKey",
				"remoteVersion",
				"remoteDeleted",
				"acknowledged"
			)
			WHERE link."sourceConnectionKey" = ${sourceConnectionKey}
				AND link."collectionKey" = incoming."collectionKey"
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

export async function writeSourceIngestionBatch(db: Database, input: unknown) {
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
			sourceItemValues(record),
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

		const collectionKeys = await reserveCollectionIdentities(transaction, {
			sourceConnectionKey: batch.sourceConnectionKey,
			sourceRecordKeys: collectionUpserts.map(
				(record) => record.sourceRecordKey,
			),
		});
		const itemKeys = await reserveItemSourceLinks(transaction, {
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
				...collectionDeletes.map((record) => record.sourceRecordKey),
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
		await ensureCollectionSourceLinks(
			transaction,
			batch.sourceConnectionKey,
			batch.collections.flatMap((record) => {
				const collectionKey = collectionKeys.get(
					record.sourceRecordKey,
				);
				return collectionKey
					? [
							{
								collectionKey,
								sourceRecordKey: record.sourceRecordKey,
							},
						]
					: [];
			}),
		);

		const batchItemKeys = [...new Set(itemKeys.values())];
		const existingParentRows =
			batchItemKeys.length === 0
				? []
				: await transaction
						.select({ parentItem: item.parentItem })
						.from(item)
						.where(inArray(item.key, batchItemKeys));
		const allItemKeys = [
			...new Set([
				...batchItemKeys,
				...existingParentRows.flatMap(({ parentItem }) =>
					parentItem ? [parentItem] : [],
				),
			]),
		];
		const allCollectionKeys = [...new Set(collectionKeys.values())];
		await lockCollectionMutations(transaction, allCollectionKeys);
		await lockItemMutations(transaction, allItemKeys);
		const existingItems =
			batchItemKeys.length === 0
				? []
				: await transaction
						.select()
						.from(item)
						.where(inArray(item.key, batchItemKeys))
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
							parentCollection: collection.parentCollection,
							relations: collection.relations,
							sourceConnectionKey: collection.sourceConnectionKey,
						})
						.from(collection)
						.where(inArray(collection.key, allCollectionKeys))
						.orderBy(collection.key)
						.for("update");
		const existingItemByKey = new Map(
			existingItems.map((row) => [row.key, row]),
		);
		const sourceLinks =
			batchItemKeys.length === 0
				? []
				: await transaction
						.select()
						.from(itemSourceLink)
						.where(
							and(
								eq(
									itemSourceLink.sourceConnectionKey,
									batch.sourceConnectionKey,
								),
								inArray(itemSourceLink.itemKey, batchItemKeys),
							),
						)
						.orderBy(itemSourceLink.itemKey)
						.for("update");
		const sourceLinkByItemKey = new Map(
			sourceLinks.map((row) => [row.itemKey, row]),
		);
		const existingCitationMetrics =
			batchItemKeys.length === 0
				? []
				: await transaction
						.select()
						.from(itemCitationMetric)
						.where(
							and(
								eq(
									itemCitationMetric.sourceConnectionKey,
									batch.sourceConnectionKey,
								),
								inArray(itemCitationMetric.itemKey, batchItemKeys),
							),
						)
						.orderBy(itemCitationMetric.itemKey)
						.for("update");
		const citationMetricByItemKey = new Map(
			existingCitationMetrics.map((row) => [row.itemKey, row]),
		);
		const collectionSourceLinks =
			allCollectionKeys.length === 0
				? []
				: await transaction
						.select()
						.from(collectionSourceLink)
						.where(
							and(
								eq(
									collectionSourceLink.sourceConnectionKey,
									batch.sourceConnectionKey,
								),
								inArray(
									collectionSourceLink.collectionKey,
									allCollectionKeys,
								),
							),
						)
						.orderBy(collectionSourceLink.collectionKey)
						.for("update");
		const sourceLinkByCollectionKey = new Map(
			collectionSourceLinks.map((row) => [row.collectionKey, row]),
		);
		const existingCollectionByKey = new Map(
			existingCollections.map((row) => [row.key, row]),
		);
		const snapshots =
			batchItemKeys.length === 0
				? []
				: await transaction
						.select()
						.from(sourceSnapshot)
						.where(
							and(
								eq(
									sourceSnapshot.sourceConnectionKey,
									batch.sourceConnectionKey,
								),
								inArray(sourceSnapshot.itemKey, batchItemKeys),
							),
						);
		const snapshotByItemKey = new Map(
			snapshots.map((row) => [row.itemKey, row]),
		);
		const collectionSnapshots =
			allCollectionKeys.length === 0
				? []
				: await transaction
						.select()
						.from(collectionSourceSnapshot)
						.where(
							and(
								eq(
									collectionSourceSnapshot.sourceConnectionKey,
									batch.sourceConnectionKey,
								),
								inArray(
									collectionSourceSnapshot.collectionKey,
									allCollectionKeys,
								),
							),
						);
		const snapshotByCollectionKey = new Map(
			collectionSnapshots.map((row) => [row.collectionKey, row]),
		);
		const existingPublications =
			batchItemKeys.length === 0
				? []
				: await transaction
						.select()
						.from(itemFilePublication)
						.where(
							inArray(itemFilePublication.itemKey, batchItemKeys),
						)
						.orderBy(itemFilePublication.itemKey)
						.for("update");
		const existingPublicationByItemKey = new Map(
			existingPublications.map((row) => [row.itemKey, row]),
		);
		const existingTagRows =
			batchItemKeys.length === 0
				? []
				: await transaction
						.select({
							itemKey: itemToTag.itemKey,
							tagName: itemToTag.tagName,
						})
						.from(itemToTag)
						.where(inArray(itemToTag.itemKey, batchItemKeys));
		const existingCollectionRows =
			batchItemKeys.length === 0
				? []
				: await transaction
						.select({
							collectionKey: itemToCollection.collectionKey,
							collectionSourceConnectionKey:
								collection.sourceConnectionKey,
							itemKey: itemToCollection.itemKey,
						})
						.from(itemToCollection)
						.innerJoin(
							collection,
							eq(collection.key, itemToCollection.collectionKey),
						)
						.where(
							inArray(itemToCollection.itemKey, batchItemKeys),
						);
		const existingTagsByItemKey = new Map<string, string[]>();
		for (const row of existingTagRows) {
			const values = existingTagsByItemKey.get(row.itemKey) ?? [];
			values.push(row.tagName);
			existingTagsByItemKey.set(row.itemKey, values);
		}
		const existingCollectionsByItemKey = new Map<string, string[]>();
		const foreignCollectionsByItemKey = new Map<string, string[]>();
		for (const row of existingCollectionRows) {
			const values = existingCollectionsByItemKey.get(row.itemKey) ?? [];
			values.push(row.collectionKey);
			existingCollectionsByItemKey.set(row.itemKey, values);
			if (
				row.collectionSourceConnectionKey !== batch.sourceConnectionKey
			) {
				const foreignValues =
					foreignCollectionsByItemKey.get(row.itemKey) ?? [];
				foreignValues.push(row.collectionKey);
				foreignCollectionsByItemKey.set(row.itemKey, foreignValues);
			}
		}

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
			const parentKey = collectionKeys.get(record.parentSourceRecordKey);
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
		const resolvedCollectionReferences = await resolveCollectionReferences(
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
		const effectiveCollectionStateByRecordKey = new Map(
			collectionUpserts.map((record) => {
				const key = collectionKeys.get(record.sourceRecordKey)!;
				const existing = existingCollectionByKey.get(key);
				const dirtyFields = new Set(
					sourceLinkByCollectionKey.get(key)?.dirtyFields ?? [],
				);
				return [
					record.sourceRecordKey,
					{
						name:
							existing && dirtyFields.has("name")
								? existing.name
								: record.data.name,
						numCollections: record.data.numCollections,
						numItems: record.data.numItems,
						parentCollection:
							existing && dirtyFields.has("parentCollection")
								? existing.parentCollection
								: (parentCollectionKeys.get(
										record.sourceRecordKey,
									) ?? null),
						relations: record.data.relations,
					},
				] as const;
			}),
		);
		const changedCollectionUpserts = collectionUpserts.filter((record) => {
			const key = collectionKeys.get(record.sourceRecordKey)!;
			const existing = existingCollectionByKey.get(key);
			if (!existing) return true;
			if (existing.deleted === 1) {
				return !sourceLinkByCollectionKey
					.get(key)
					?.dirtyFields.includes("deleted");
			}
			const snapshot = snapshotByCollectionKey.get(key);
			const sourceChanged =
				!snapshot ||
				snapshot.payloadHash !== sourceCollectionFingerprint(record) ||
				snapshot.mappingProfileVersion !== batch.mappingProfileVersion;
			if (!sourceChanged) return false;
			const state = effectiveCollectionStateByRecordKey.get(
				record.sourceRecordKey,
			)!;
			return (
				existing.name !== state.name ||
				existing.numCollections !== state.numCollections ||
				existing.numItems !== state.numItems ||
				existing.parentCollection !== state.parentCollection ||
				!nullableJsonEqual(
					existing.relations as Record<string, unknown> | null,
					state.relations,
				)
			);
		});
		const writtenCollections = await writeCollectionRows(
			transaction,
			changedCollectionUpserts.map((record) => {
				const state = effectiveCollectionStateByRecordKey.get(
					record.sourceRecordKey,
				)!;
				return {
					key: collectionKeys.get(record.sourceRecordKey)!,
					sourceConnectionKey: batch.sourceConnectionKey,
					sourceRecordKey: record.sourceRecordKey,
					revision: 1,
					name: state.name,
					numCollections: state.numCollections,
					numItems: state.numItems,
					relations: state.relations,
					parentCollection: null,
					deleted: 0,
					deletedAt: null,
					updatedAt: now,
				};
			}),
		);
		for (const row of writtenCollections) {
			collectionEvents.set(row.key, {
				operation: "upsert",
				revision: row.revision,
			});
		}
		const collectionDeleteKeys = collectionDeletes.flatMap((record) => {
			const key = collectionKeys.get(record.sourceRecordKey);
			const existing = key ? existingCollectionByKey.get(key) : undefined;
			const pendingLocalRestore = key
				? sourceLinkByCollectionKey
						.get(key)
						?.dirtyFields.includes("deleted")
				: false;
			return key &&
				existing &&
				existing.deleted !== 1 &&
				!pendingLocalRestore
				? [key]
				: [];
		});
		const collectionDeleteKeySet = new Set(collectionDeleteKeys);
		const activeParentCollectionKeys = [
			...new Set(
				changedCollectionUpserts.flatMap((record) => {
					const parentKey = effectiveCollectionStateByRecordKey.get(
						record.sourceRecordKey,
					)!.parentCollection;
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
						inArray(collection.key, activeParentCollectionKeys),
						eq(collection.deleted, 0),
					),
				);
			if (activeParents.length !== activeParentCollectionKeys.length) {
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
				parentKey: effectiveCollectionStateByRecordKey.get(
					record.sourceRecordKey,
				)!.parentCollection,
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
			changedCollectionUpserts.map((record) =>
				collectionKeys.get(record.sourceRecordKey)!,
			),
		);

		const effectiveItemStateByRecordKey = new Map(
			itemUpserts.map((record) => {
				const key = itemKeys.get(record.sourceRecordKey)!;
				const existing = existingItemByKey.get(key);
				const dirtyFields = new Set(
					sourceLinkByItemKey.get(key)?.dirtyFields ?? [],
				);
				const normalized = normalizedItems.get(record.sourceRecordKey)!;
				const existingPublication =
					existingPublicationByItemKey.get(key);
				const protectsManagedPublication =
					!sourceOwnsCanonicalItem(
						existing,
						batch.sourceConnectionKey,
					) && Boolean(existingPublication);
				const incomingCollections = normalized.collectionReferences.map(
					(reference) => {
						const connectionKey =
							reference.sourceConnectionKey ??
							batch.sourceConnectionKey;
						return resolvedCollectionReferences.get(
							`${connectionKey}\u0000${reference.sourceRecordKey}`,
						)!;
					},
				);
				return [
					record.sourceRecordKey,
					{
						collections: dirtyFields.has("collections")
							? (existingCollectionsByItemKey.get(key) ?? [])
							: [
									...new Set([
										...(foreignCollectionsByItemKey.get(
											key,
										) ?? []),
										...incomingCollections,
									]),
								].sort(),
						dirtyFields,
						item: preserveForeignOwnedFileFields(
							maskDirtyItemFields(
								{ ...normalized.item, creators: preserveCreatorProfileLinks(normalized.item.creators, existing?.creators) },
								existing,
								dirtyFields,
							),
							existing,
							batch.sourceConnectionKey,
							protectsManagedPublication,
						),
						parentItem: protectsManagedPublication
							? (existing?.parentItem ?? null)
							: dirtyFields.has("parentItem")
								? (existing?.parentItem ?? null)
								: (parentItemKeys.get(record.sourceRecordKey) ??
									null),
						tags: [
							...new Set([
								...(dirtyFields.has("tags")
									? (existingTagsByItemKey.get(key) ?? [])
									: normalized.tags),
								...(sourceOwnsCanonicalItem(
									existing,
									batch.sourceConnectionKey,
								)
									? []
									: (existingPublication?.publicationTags ??
										[])),
							]),
						].sort(),
					},
				] as const;
			}),
		);
		const changedItemUpserts = itemUpserts.filter((record) => {
			const key = itemKeys.get(record.sourceRecordKey)!;
			const existing = existingItemByKey.get(key);
			if (!existing) return true;
			if (existing.deleted === 1) {
				return (
					existing.sourceConnectionKey === batch.sourceConnectionKey
				);
			}
			const snapshot = snapshotByItemKey.get(key);
			const sourceChanged =
				!snapshot ||
				snapshot.payloadHash !== sourceItemFingerprint(record) ||
				snapshot.mappingProfileVersion !== batch.mappingProfileVersion;
			if (!sourceChanged) return false;

			const state = effectiveItemStateByRecordKey.get(
				record.sourceRecordKey,
			)!;
			const publication = record.file?.managedPublication;
			const existingPublication = existingPublicationByItemKey.get(key);
			const publicationChanged = sourceOwnsCanonicalItem(
				existing,
				batch.sourceConnectionKey,
			)
				? publication
					? !existingPublication ||
						existingPublication.objectPath !==
							publication.objectPath ||
						existingPublication.coverObjectPath !==
							publication.coverObjectPath ||
						existingPublication.sizeBytes !==
							publication.sizeBytes ||
						existingPublication.sha256 !== publication.sha256 ||
						existingPublication.pageCount !== publication.pageCount
					: Boolean(existingPublication)
				: false;
			return (
				itemValuesDiffer(existing, state.item) ||
				existing.parentItem !== state.parentItem ||
				!stringSetEqual(
					existingTagsByItemKey.get(key) ?? [],
					state.tags,
				) ||
				!stringSetEqual(
					existingCollectionsByItemKey.get(key) ?? [],
					state.collections,
				) ||
				publicationChanged
			);
		});
		const itemEvents = new Map<
			string,
			{ operation: "delete" | "upsert"; revision: number }
		>();
		const writtenItems = await writeItemRows(
			transaction,
			changedItemUpserts.map((record) => {
				const key = itemKeys.get(record.sourceRecordKey)!;
				const existing = existingItemByKey.get(key);
				return {
					...effectiveItemStateByRecordKey.get(
						record.sourceRecordKey,
					)!.item,
					key,
					sourceConnectionKey:
						existing?.sourceConnectionKey ??
						batch.sourceConnectionKey,
					sourceRecordKey:
						existing?.sourceRecordKey ?? record.sourceRecordKey,
					parentItem: null,
					revision: 1,
					deleted: 0,
					deletedAt: null,
					updatedAt: now,
				};
			}),
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
			return key &&
				existing &&
				existing.sourceConnectionKey === batch.sourceConnectionKey &&
				existing.deleted !== 1
				? [key]
				: [];
		});
		const itemDeleteKeySet = new Set(itemDeleteKeys);
		const activeParentItemKeys = [
			...new Set(
				changedItemUpserts.flatMap((record) => {
					const parentKey = effectiveItemStateByRecordKey.get(
						record.sourceRecordKey,
					)!.parentItem;
					return parentKey ? [parentKey] : [];
				}),
			),
		];
		if (activeParentItemKeys.some((key) => itemDeleteKeySet.has(key))) {
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
				throw new SourceReferenceNotFoundError("item", "active parent");
			}
		}
		await updateItemParents(
			transaction,
			changedItemUpserts.map((record) => ({
				key: itemKeys.get(record.sourceRecordKey)!,
				parentKey: effectiveItemStateByRecordKey.get(
					record.sourceRecordKey,
				)!.parentItem,
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
			changedItemUpserts.map((record) =>
				itemKeys.get(record.sourceRecordKey)!,
			),
		);

		const writtenItemRevisionByKey = new Map(
			writtenItems.map((row) => [row.key, row.revision]),
		);
		const publicationUpserts = changedItemUpserts.flatMap((record) => {
			const publication = record.file?.managedPublication;
			if (!publication || !record.file) return [];
			const itemKey = itemKeys.get(record.sourceRecordKey)!;
			if (
				!sourceOwnsCanonicalItem(
					existingItemByKey.get(itemKey),
					batch.sourceConnectionKey,
				)
			) {
				return [];
			}
			const parentItemKey = effectiveItemStateByRecordKey.get(
				record.sourceRecordKey,
			)!.parentItem;
			const revision = writtenItemRevisionByKey.get(itemKey);
			if (!parentItemKey || revision === undefined) {
				throw new SourceIngestionValidationError(
					`Managed source file ${record.sourceRecordKey} requires a written parent attachment`,
				);
			}
			const previous = existingPublicationByItemKey.get(itemKey);
			const sameContent =
				previous?.sha256 === publication.sha256 &&
				previous.objectPath === publication.objectPath &&
				previous.coverObjectPath === publication.coverObjectPath;
			return [
				{
					itemKey,
					sourceConnectionKey: batch.sourceConnectionKey,
					parentItemKey,
					uploadRevision: sameContent
						? previous.uploadRevision
						: (previous?.uploadRevision ?? 0) + 1,
					revision,
					sourceObjectPath: publication.objectPath,
					sourceCoverObjectPath: publication.coverObjectPath,
					objectPath: publication.objectPath,
					publicUrl: record.file.url!,
					filename: record.file.filename!,
					contentType: record.file.contentType!,
					sizeBytes: publication.sizeBytes,
					sha256: publication.sha256,
					md5: record.file.md5!,
					coverObjectPath: publication.coverObjectPath,
					coverPublicUrl: record.file.coverUrl!,
					coverWidth: record.file.coverWidth!,
					coverHeight: record.file.coverHeight!,
					pageCount: publication.pageCount,
					publishedAt: sameContent ? previous.publishedAt : now,
					updatedAt: now,
				},
			];
		});
		const publicationUpsertByItemKey = new Map(
			publicationUpserts.map((row) => [row.itemKey, row]),
		);
		const publicationDeleteItemKeys = [
			...new Set([
				...itemDeleteKeys,
				...changedItemUpserts.flatMap((record) => {
					const itemKey = itemKeys.get(record.sourceRecordKey)!;
					return sourceOwnsCanonicalItem(
						existingItemByKey.get(itemKey),
						batch.sourceConnectionKey,
					) && !record.file?.managedPublication
						? [itemKey]
						: [];
				}),
			]),
		].filter(
			(itemKey) =>
				existingPublicationByItemKey.has(itemKey) &&
				!publicationUpsertByItemKey.has(itemKey),
		);
		const publicationDeleteItemKeySet = new Set(publicationDeleteItemKeys);
		const activePublicationPaths = new Set(
			publicationUpserts.flatMap((row) => [
				row.objectPath,
				row.coverObjectPath,
			]),
		);
		const stalePublicationPaths = [
			...new Set(
				existingPublications.flatMap((previous) => {
					const next = publicationUpsertByItemKey.get(
						previous.itemKey,
					);
					const removed = publicationDeleteItemKeySet.has(
						previous.itemKey,
					);
					if (!removed && !next) return [];
					return [
						previous.objectPath,
						previous.coverObjectPath,
					].filter(
						(objectPath) => !activePublicationPaths.has(objectPath),
					);
				}),
			),
		];

		if (activePublicationPaths.size > 0) {
			const consumedStagingRows = await transaction
				.delete(sourceFileCleanup)
				.where(
					and(
						eq(
							sourceFileCleanup.sourceConnectionKey,
							batch.sourceConnectionKey,
						),
						inArray(sourceFileCleanup.objectPath, [
							...activePublicationPaths,
						]),
					),
				)
				.returning({ objectPath: sourceFileCleanup.objectPath });
			const consumedPaths = new Set(
				consumedStagingRows.map(({ objectPath }) => objectPath),
			);
			const missingStagedPaths = changedItemUpserts.flatMap((record) => {
				const existing = existingItemByKey.get(
					itemKeys.get(record.sourceRecordKey)!,
				);
				if (
					!sourceOwnsCanonicalItem(
						existing,
						batch.sourceConnectionKey,
					)
				) {
					return [];
				}
				const publication = record.file?.managedPublication;
				if (!publication?.staged) return [];
				return [
					publication.objectPath,
					publication.coverObjectPath,
				].filter((objectPath) => !consumedPaths.has(objectPath));
			});
			if (missingStagedPaths.length > 0) {
				throw new SourceFileStagingConflictError(
					batch.sourceConnectionKey,
					missingStagedPaths,
				);
			}
		}
		if (publicationDeleteItemKeys.length > 0) {
			await transaction
				.delete(itemFilePublication)
				.where(
					inArray(
						itemFilePublication.itemKey,
						publicationDeleteItemKeys,
					),
				);
		}
		await insertInChunks(
			publicationUpserts,
			RELATION_CHUNK_SIZE,
			(rowChunk) =>
				transaction
					.insert(itemFilePublication)
					.values(rowChunk)
					.onConflictDoUpdate({
						target: itemFilePublication.itemKey,
						set: {
							sourceConnectionKey: sql.raw(
								`excluded."sourceConnectionKey"`,
							),
							parentItemKey: sql.raw(`excluded."parentItemKey"`),
							uploadRevision: sql.raw(
								`excluded."uploadRevision"`,
							),
							revision: sql.raw(`excluded."revision"`),
							sourceObjectPath: sql.raw(
								`excluded."sourceObjectPath"`,
							),
							sourceCoverObjectPath: sql.raw(
								`excluded."sourceCoverObjectPath"`,
							),
							objectPath: sql.raw(`excluded."objectPath"`),
							publicUrl: sql.raw(`excluded."publicUrl"`),
							filename: sql.raw(`excluded."filename"`),
							contentType: sql.raw(`excluded."contentType"`),
							sizeBytes: sql.raw(`excluded."sizeBytes"`),
							sha256: sql.raw(`excluded."sha256"`),
							md5: sql.raw(`excluded."md5"`),
							coverObjectPath: sql.raw(
								`excluded."coverObjectPath"`,
							),
							coverPublicUrl: sql.raw(
								`excluded."coverPublicUrl"`,
							),
							coverWidth: sql.raw(`excluded."coverWidth"`),
							coverHeight: sql.raw(`excluded."coverHeight"`),
							pageCount: sql.raw(`excluded."pageCount"`),
							publishedAt: sql.raw(`excluded."publishedAt"`),
							updatedAt: sql.raw(`excluded."updatedAt"`),
						},
					}),
		);
		await insertInChunks(
			stalePublicationPaths.map((objectPath) => ({
				sourceConnectionKey: batch.sourceConnectionKey,
				objectPath,
				updatedAt: now,
			})),
			RELATION_CHUNK_SIZE,
			(rowChunk) =>
				transaction
					.insert(sourceFileCleanup)
					.values(rowChunk)
					.onConflictDoUpdate({
						target: [
							sourceFileCleanup.sourceConnectionKey,
							sourceFileCleanup.objectPath,
						],
						set: {
							attempts: 0,
							deadLetteredAt: null,
							lastError: null,
							updatedAt: now,
						},
					}),
		);

		const changedItemKeys = changedItemUpserts.map((record) =>
			itemKeys.get(record.sourceRecordKey)!,
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
			effectiveItemStateByRecordKey
				.get(record.sourceRecordKey)!
				.tags.map((name) => ({ name })),
		);
		await insertInChunks(
			[...new Map(tagRows.map((row) => [row.name, row])).values()],
			RELATION_CHUNK_SIZE,
			(rowChunk) =>
				transaction.insert(tag).values(rowChunk).onConflictDoNothing(),
		);
		const itemTagRows = changedItemUpserts.flatMap((record) =>
			effectiveItemStateByRecordKey
				.get(record.sourceRecordKey)!
				.tags.map((tagName) => ({
					itemKey: itemKeys.get(record.sourceRecordKey)!,
					tagName,
				})),
		);
		await insertInChunks(itemTagRows, RELATION_CHUNK_SIZE, (rowChunk) =>
			transaction.insert(itemToTag).values(rowChunk),
		);

		const itemCollectionRows = changedItemUpserts.flatMap((record) =>
			effectiveItemStateByRecordKey
				.get(record.sourceRecordKey)!
				.collections.map((collectionKey) => ({
					itemKey: itemKeys.get(record.sourceRecordKey)!,
					collectionKey,
				})),
		);
		const activeCollectionKeys = [
			...new Set(itemCollectionRows.map((row) => row.collectionKey)),
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
			if (activeCollections.length !== activeCollectionKeys.length) {
				throw new SourceReferenceNotFoundError(
					"collection",
					"active relationship",
				);
			}
		}
		await insertInChunks(
			itemCollectionRows,
			RELATION_CHUNK_SIZE,
			(rowChunk) => transaction.insert(itemToCollection).values(rowChunk),
		);

		// Mirror the source's "related" links (Zotero dc:relation) for every top-level
		// record in this batch. Only URIs that name this connection's own library
		// resolve; every other URI is counted as unresolved and retried on the next
		// sync of that record.
		const relatedTargetsByRecordKey = new Map<string, string[]>();
		let unresolvedRelations = 0;
		for (const record of itemUpserts) {
			if (record.parentSourceRecordKey) continue;
			const relations = normalizedItems.get(record.sourceRecordKey)!.item
				.relations as Record<string, unknown> | null | undefined;
			const uris = relationUris(relations?.["dc:relation"]);
			relatedTargetsByRecordKey.set(
				record.sourceRecordKey,
				uris.flatMap((uri) => {
					const parsed = parseZoteroItemUri(uri);
					if (!parsed || !uriBelongsToConnection(parsed, connection)) {
						unresolvedRelations += 1;
						return [];
					}
					return [parsed.itemKey];
				}),
			);
		}
		const relatedSourceKeys = [
			...new Set([...relatedTargetsByRecordKey.values()].flat()),
		].filter((key) => !itemKeys.has(key));
		const relatedIdentity = await loadIdentityMap(
			transaction,
			"item",
			batch.sourceConnectionKey,
			relatedSourceKeys,
		);
		const relatedLinkRows: { fromKey: string; toKey: string }[] = [];
		for (const [sourceRecordKey, targets] of relatedTargetsByRecordKey) {
			const fromKey = itemKeys.get(sourceRecordKey)!;
			for (const target of targets) {
				const toKey = itemKeys.get(target) ?? relatedIdentity.get(target);
				if (!toKey) {
					unresolvedRelations += 1;
					continue;
				}
				if (toKey === fromKey) continue;
				relatedLinkRows.push({ fromKey, toKey });
			}
		}
		const relatedLinkChange = await replaceSourceLinks(transaction, {
			sourceConnectionKey: batch.sourceConnectionKey,
			kind: "related",
			fromKeys: [...relatedTargetsByRecordKey.keys()].map(
				(sourceRecordKey) => itemKeys.get(sourceRecordKey)!,
			),
			links: relatedLinkRows,
		});

		// Source citation metrics are observations, not library-link totals. Keep
		// them in their own table and replace this source's value for every record
		// it sent. A null value means the source no longer reports the metric.
		const citationMetricChangedItemKeys = new Set<string>();
		const citationMetricUpserts = itemUpserts.flatMap((record) => {
			const itemKey = itemKeys.get(record.sourceRecordKey)!;
			const incoming = record.citationMetric;
			const existing = citationMetricByItemKey.get(itemKey);
			if (!incoming) {
				if (existing) citationMetricChangedItemKeys.add(itemKey);
				return [];
			}
			if (
				!existing ||
				existing.citedByCount !== incoming.citedByCount ||
				existing.referencedWorksCount !== incoming.referencedWorksCount
			) {
				citationMetricChangedItemKeys.add(itemKey);
			}
			return [
				{
					itemKey,
					sourceConnectionKey: batch.sourceConnectionKey,
					citedByCount: incoming.citedByCount,
					referencedWorksCount: incoming.referencedWorksCount,
					observedAt: batch.fetchedAt,
				},
			];
		});
		const citationMetricDeleteKeys = batch.items.flatMap((record) => {
			const itemKey = itemKeys.get(record.sourceRecordKey);
			if (!itemKey || !citationMetricByItemKey.has(itemKey)) return [];
			if (record.operation === "delete" || record.citationMetric === null) {
				citationMetricChangedItemKeys.add(itemKey);
				return [itemKey];
			}
			return [];
		});
		if (citationMetricDeleteKeys.length > 0) {
			await transaction
				.delete(itemCitationMetric)
				.where(
					and(
						eq(
							itemCitationMetric.sourceConnectionKey,
							batch.sourceConnectionKey,
						),
						inArray(itemCitationMetric.itemKey, citationMetricDeleteKeys),
					),
				);
		}
		await insertInChunks(
			citationMetricUpserts,
			RELATION_CHUNK_SIZE,
			(rowChunk) =>
				transaction
					.insert(itemCitationMetric)
					.values(rowChunk)
					.onConflictDoUpdate({
						target: [
							itemCitationMetric.itemKey,
							itemCitationMetric.sourceConnectionKey,
						],
						set: {
							citedByCount: sql.raw(`excluded."citedByCount"`),
							referencedWorksCount: sql.raw(
								`excluded."referencedWorksCount"`,
							),
							observedAt: sql.raw(`excluded."observedAt"`),
						},
					}),
		);

		// Provider references become source-owned citation links only when the
		// target already resolves in this library. Unknown provider IDs stay only
		// in the raw source snapshot and are retried by a later sync.
		const citationTargetsByRecordKey = new Map(
			itemUpserts
				.filter((record) => !record.parentSourceRecordKey)
				.map((record) => [
					record.sourceRecordKey,
					record.referencedSourceRecordKeys,
				] as const),
		);
		const citationSourceKeys = [
			...new Set([...citationTargetsByRecordKey.values()].flat()),
		].filter((key) => !itemKeys.has(key));
		const citationIdentity = await loadIdentityMap(
			transaction,
			"item",
			batch.sourceConnectionKey,
			citationSourceKeys,
		);
		let unresolvedCitations = 0;
		const citationLinkRows: { fromKey: string; toKey: string }[] = [];
		for (const [sourceRecordKey, targets] of citationTargetsByRecordKey) {
			const fromKey = itemKeys.get(sourceRecordKey)!;
			for (const target of targets) {
				const toKey = itemKeys.get(target) ?? citationIdentity.get(target);
				if (!toKey) {
					unresolvedCitations += 1;
					continue;
				}
				if (toKey !== fromKey) citationLinkRows.push({ fromKey, toKey });
			}
		}
		const citationLinkChange = await replaceSourceLinks(transaction, {
			sourceConnectionKey: batch.sourceConnectionKey,
			kind: "cites",
			fromKeys: [
				...citationTargetsByRecordKey.keys(),
				...itemDeletes.map((record) => record.sourceRecordKey),
			].flatMap((sourceRecordKey) => {
				const itemKey = itemKeys.get(sourceRecordKey);
				return itemKey ? [itemKey] : [];
			}),
			links: citationLinkRows,
		});

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
				(row) => expectedByAlias.get(row.aliasKey) !== row.itemKey,
			);
			if (conflict) {
				throw new SourceAliasConflictError(conflict.aliasKey);
			}
			await insertInChunks(aliasRows, RELATION_CHUNK_SIZE, (rowChunk) =>
				transaction
					.insert(sourceRecordAlias)
					.values(rowChunk)
					.onConflictDoNothing(),
			);
		}

		const collectionSnapshotRows = batch.collections.flatMap((record) => {
			const collectionKey = collectionKeys.get(record.sourceRecordKey);
			if (!collectionKey) return [];
			const expectedHash =
				record.operation === "upsert"
					? sourceCollectionFingerprint(record)
					: sourcePayloadHash(record.raw);
			const existingSnapshot = snapshotByCollectionKey.get(collectionKey);
			if (
				existingSnapshot?.payloadHash === expectedHash &&
				existingSnapshot.remoteVersion === record.remoteVersion &&
				existingSnapshot.mappingProfileVersion ===
					batch.mappingProfileVersion
			) {
				return [];
			}
			return [
				{
					collectionKey,
					sourceConnectionKey: batch.sourceConnectionKey,
					payload: record.raw,
					payloadHash: expectedHash,
					remoteVersion: record.remoteVersion,
					mappingProfileVersion: batch.mappingProfileVersion,
					fetchedAt: batch.fetchedAt,
				},
			];
		});
		const replacedCollectionSnapshotKeys = new Set(
			collectionSnapshotRows.map((row) => row.collectionKey),
		);
		const refreshedCollectionSnapshotKeys = batch.collections.flatMap(
			(record) => {
				const collectionKey = collectionKeys.get(
					record.sourceRecordKey,
				);
				return collectionKey &&
					!replacedCollectionSnapshotKeys.has(collectionKey)
					? [collectionKey]
					: [];
			},
		);
		await insertInChunks(
			collectionSnapshotRows,
			RELATION_CHUNK_SIZE,
			(rowChunk) =>
				transaction
					.insert(collectionSourceSnapshot)
					.values(rowChunk)
					.onConflictDoUpdate({
						target: [
							collectionSourceSnapshot.collectionKey,
							collectionSourceSnapshot.sourceConnectionKey,
						],
						set: {
							payload: sql.raw(`excluded."payload"`),
							payloadHash: sql.raw(`excluded."payloadHash"`),
							remoteVersion: sql.raw(`excluded."remoteVersion"`),
							mappingProfileVersion: sql.raw(
								`excluded."mappingProfileVersion"`,
							),
							fetchedAt: sql.raw(`excluded."fetchedAt"`),
						},
					}),
		);
		await insertInChunks(
			refreshedCollectionSnapshotKeys,
			RELATION_CHUNK_SIZE,
			(keyChunk) =>
				transaction
					.update(collectionSourceSnapshot)
					.set({ fetchedAt: batch.fetchedAt })
					.where(
						and(
							eq(
								collectionSourceSnapshot.sourceConnectionKey,
								batch.sourceConnectionKey,
							),
							inArray(
								collectionSourceSnapshot.collectionKey,
								keyChunk,
							),
						),
					),
		);

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
				existingSnapshot.remoteVersion === record.remoteVersion &&
				existingSnapshot.mappingProfileVersion ===
					batch.mappingProfileVersion
			) {
				return [];
			}
			return [
				{
					itemKey,
					sourceConnectionKey: batch.sourceConnectionKey,
					payload: record.raw,
					payloadHash: expectedHash,
					remoteVersion: record.remoteVersion,
					mappingProfileVersion: batch.mappingProfileVersion,
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
		await insertInChunks(snapshotRows, RELATION_CHUNK_SIZE, (rowChunk) =>
			transaction
				.insert(sourceSnapshot)
				.values(rowChunk)
				.onConflictDoUpdate({
					target: [
						sourceSnapshot.itemKey,
						sourceSnapshot.sourceConnectionKey,
					],
					set: {
						payload: sql.raw(`excluded."payload"`),
						payloadHash: sql.raw(`excluded."payloadHash"`),
						remoteVersion: sql.raw(`excluded."remoteVersion"`),
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
					.where(
						and(
							eq(
								sourceSnapshot.sourceConnectionKey,
								batch.sourceConnectionKey,
							),
							inArray(sourceSnapshot.itemKey, keyChunk),
						),
					),
		);
		await updateItemSourceLinkVersions(
			transaction,
			batch.sourceConnectionKey,
			batch.items.flatMap((record) => {
				const itemKey = itemKeys.get(record.sourceRecordKey);
				const link = itemKey
					? sourceLinkByItemKey.get(itemKey)
					: undefined;
				const existing = itemKey
					? existingItemByKey.get(itemKey)
					: undefined;
				const remoteDeleted = record.operation === "delete";
				const acknowledged =
					(link?.dirtyFields.length ?? 0) === 0 &&
					(!remoteDeleted ||
						existing?.sourceConnectionKey ===
							batch.sourceConnectionKey);
				return itemKey
					? [
							{
								acknowledged,
								itemKey,
								remoteDeleted,
								remoteVersion: record.remoteVersion,
							},
						]
					: [];
			}),
			now,
		);
		await updateCollectionSourceLinkVersions(
			transaction,
			batch.sourceConnectionKey,
			batch.collections.flatMap((record) => {
				const collectionKey = collectionKeys.get(
					record.sourceRecordKey,
				);
				const link = collectionKey
					? sourceLinkByCollectionKey.get(collectionKey)
					: undefined;
				const existing = collectionKey
					? existingCollectionByKey.get(collectionKey)
					: undefined;
				const remoteDeleted = record.operation === "delete";
				const acknowledged =
					(link?.dirtyFields.length ?? 0) === 0 &&
					(!remoteDeleted ||
						existing?.sourceConnectionKey ===
							batch.sourceConnectionKey);
				return collectionKey
					? [
							{
								acknowledged,
								collectionKey,
								remoteDeleted,
								remoteVersion: record.remoteVersion,
							},
						]
					: [];
			}),
			now,
		);

		const directlyChangedItemKeys = new Set(itemEvents.keys());
		const affectedParentKeys = new Set<string>();
		for (const record of changedItemUpserts) {
			const key = itemKeys.get(record.sourceRecordKey)!;
			const oldParent = existingItemByKey.get(key)?.parentItem;
			const newParent = effectiveItemStateByRecordKey.get(
				record.sourceRecordKey,
			)!.parentItem;
			if (oldParent) affectedParentKeys.add(oldParent);
			if (newParent) affectedParentKeys.add(newParent);
		}
		for (const key of itemDeleteKeys) {
			const oldParent = existingItemByKey.get(key)?.parentItem;
			if (oldParent) affectedParentKeys.add(oldParent);
		}
		// Citation sidecars and source-owned links change the public projection
		// even when the canonical item fields did not change.
		for (const key of [
			...relatedLinkChange.changedItemKeys,
			...citationLinkChange.changedItemKeys,
			...citationMetricChangedItemKeys,
		]) {
			affectedParentKeys.add(key);
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

		const changedRows =
			itemEvents.size === 0
				? []
				: await transaction
						.select({
							deleted: item.deleted,
							key: item.key,
							parentItem: item.parentItem,
							revision: item.revision,
						})
						.from(item)
						.where(inArray(item.key, [...itemEvents.keys()]));
		const changedParentKeys = [
			...new Set(
				changedRows.flatMap((row) => {
					if (row.parentItem) return [row.parentItem];
					return row.deleted === 0 ? [row.key] : [];
				}),
			),
		].sort();
		const changedParents =
			changedParentKeys.length === 0
				? []
				: await transaction
						.select({ key: item.key, revision: item.revision })
						.from(item)
						.where(
							and(
								inArray(item.key, changedParentKeys),
								eq(item.deleted, 0),
							),
						)
						.orderBy(item.key);
		const fileChangedParentKeys = new Set([
			...publicationUpserts.map(({ parentItemKey }) => parentItemKey),
			...publicationDeleteItemKeys.flatMap((itemKey) => {
				const parentItemKey =
					existingPublicationByItemKey.get(itemKey)?.parentItemKey;
				return parentItemKey ? [parentItemKey] : [];
			}),
		]);
		for (const parent of changedParents) {
			await enqueuePublicationJobsForItem(transaction, {
				itemKey: parent.key,
				canonicalRevision: parent.revision,
				reason: fileChangedParentKeys.has(parent.key)
					? "file_changed"
					: "record_changed",
				now,
			});
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
			...[...itemEvents].map(([entityKey, { operation, revision }]) => ({
				entityType: "item" as const,
				entityKey,
				operation,
				revision,
			})),
		];
		await insertInChunks(outboxRows, RELATION_CHUNK_SIZE, (rowChunk) =>
			transaction.insert(outbox).values(rowChunk),
		);

		const issueSourceRecordKeys = batch.items.map(
			(record) => record.sourceRecordKey,
		);
		if (issueSourceRecordKeys.length > 0) {
			await transaction
				.delete(sourceRecordIssue)
				.where(
					and(
						eq(
							sourceRecordIssue.sourceConnectionKey,
							batch.sourceConnectionKey,
						),
						inArray(
							sourceRecordIssue.sourceRecordKey,
							issueSourceRecordKeys,
						),
					),
				);
		}
		await insertInChunks(
			itemUpserts.flatMap((record) =>
				record.processingIssue
					? [
							{
								sourceConnectionKey: batch.sourceConnectionKey,
								sourceRecordKey: record.sourceRecordKey,
								code: record.processingIssue.code,
								message: record.processingIssue.message,
								remoteVersion: record.remoteVersion,
								updatedAt: now,
							},
						]
					: [],
			),
			RELATION_CHUNK_SIZE,
			(rowChunk) =>
				transaction.insert(sourceRecordIssue).values(rowChunk),
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
				unresolvedCitations,
				unresolvedRelations,
			},
		};
	});
}
