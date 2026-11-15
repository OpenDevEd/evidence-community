import { updateOpenAlexReferences } from "./openalex/references";
import { readOpenAccess } from "@/lib/search-index/open-access";
import { isOpenAlexWorkProvider, OPENALEX_WORK_PROVIDERS } from "@/lib/source-providers";
import { itemSourceValue, sourceTopicAssignment } from "@/db/schema/topics";
import { sourceOverridesByItem } from "@/lib/admin/source-fields";
import { importedTopics, effectiveSourceTopics } from "@/lib/topics/assignments";
import { institutionCountry } from "@/db/schema/tables/institutionCountry";
import { reindexAuthorsAt } from "@/lib/admin/institution-countries";
import { institutionNameKey } from "@/config/library-config/institutions";
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
	isNotNull,
	isNull,
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
import { enqueueItemSearchReprojections, enqueuePublicationJobsForItem } from "@/lib/publication/queue";
import { publicationTarget } from "@/db/schema/publication";

import {
	type SourceItemUpsert,
	type JsonValue,
	type SourceIngestionBatch,
	sourceIngestionBatchSchema,
} from "./batch-schema";
import { chunkValues } from "@/lib/chunk-values";
import { retryTransientConflicts } from "@/db/transient-conflict";
import { replaceZoteroCitationLinks } from "./zotero/citations";
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

type SourceValueRow = typeof itemSourceValue.$inferInsert;
type TopicAssignmentRow = typeof sourceTopicAssignment.$inferInsert;

/** A page's source values and topic assignments, in a few statements instead of three per record. */
async function writeSourceValues(
	transaction: Transaction,
	batch: SourceIngestionBatch,
	records: SourceItemUpsert[],
	rowsFor: (record: SourceItemUpsert) => { state: SourceValueRow; topics?: TopicAssignmentRow[] },
) {
	const rows = new Map(records.map((record) => {
		const row = rowsFor(record);
		return [row.state.itemKey, row] as const;
	}));
	const states = [...rows.values()].map((row) => row.state);
	for (const chunk of chunkValues(states, RELATION_CHUNK_SIZE)) {
		await transaction.insert(itemSourceValue).values(chunk).onConflictDoUpdate({
			target: [itemSourceValue.itemKey, itemSourceValue.sourceConnectionKey],
			set: {
				payload: sql`excluded.payload`,
				remoteVersion: sql`excluded."remoteVersion"`,
				fetchedAt: sql`excluded."fetchedAt"`,
				importedTopics: sql`excluded."importedTopics"`,
			},
		});
	}
	const topicKeys = [...rows.values()].flatMap((row) => (row.topics ? [row.state.itemKey] : []));
	for (const chunk of chunkValues(topicKeys, RELATION_CHUNK_SIZE)) {
		await transaction.delete(sourceTopicAssignment).where(and(
			inArray(sourceTopicAssignment.itemKey, chunk),
			eq(sourceTopicAssignment.sourceConnectionKey, batch.sourceConnectionKey),
		));
	}
	const topics = [...rows.values()].flatMap((row) => row.topics ?? []);
	for (const chunk of chunkValues(topics, RELATION_CHUNK_SIZE)) {
		await transaction.insert(sourceTopicAssignment).values(chunk);
	}
}

/**
 * Queues linked records for search again, as their top-level records, at
 * their current revision. Their search rows are locked in key order, so no
 * worker claims one halfway. A record a worker is indexing right now is
 * returned instead: it takes a new revision, so the worker's result is
 * followed by a fresh event.
 */
async function requeueLinkedRecords(
	transaction: Transaction,
	keys: string[],
	written: ReadonlySet<string>,
	queuedAt: Date,
	sourceSyncRunId: number | null,
) {
	const roots = new Set<string>();
	for (const chunk of chunkValues(keys, 10_000)) {
		const rows = await transaction.select({ key: item.key, parentItem: item.parentItem }).from(item).where(inArray(item.key, chunk));
		for (const row of rows) roots.add(row.parentItem ?? row.key);
	}
	const current: { itemKey: string; revision: number }[] = [];
	for (const chunk of chunkValues([...roots].filter((key) => !written.has(key)), 10_000)) {
		current.push(...(await transaction
			.select({ itemKey: item.key, revision: item.revision })
			.from(item)
			.where(and(inArray(item.key, chunk), eq(item.deleted, 0)))));
	}
	// One key order across chunks, so two imports locking the same records cannot deadlock.
	current.sort((left, right) => (left.itemKey < right.itemKey ? -1 : left.itemKey > right.itemKey ? 1 : 0));
	const leased = new Set<string>();
	for (const chunk of chunkValues(current, 1_000)) {
		const values = sql.join(chunk.map((entry) => sql`(${entry.itemKey}, ${entry.revision}::bigint)`), sql`, `);
		const rows = await transaction.execute<{ entityKey: string; leased: boolean }>(sql`
			SELECT o."entityKey", (o."processedAt" IS NULL AND o."leaseExpiresAt" > ${queuedAt}) AS leased
			FROM "outbox" o
			JOIN (VALUES ${values}) AS v("key", "revision")
				ON o."entityType" = 'item' AND o."entityKey" = v."key" AND o."revision" = v."revision"
			ORDER BY o."entityKey"
			FOR UPDATE OF o
		`);
		for (const row of rows.rows) if (row.leased) leased.add(row.entityKey);
	}
	await enqueueItemSearchReprojections(transaction, current.filter((entry) => !leased.has(entry.itemKey)), queuedAt, sourceSyncRunId);
	return [...leased];
}

async function publicationTargetedKeys(transaction: Transaction, keys: string[]) {
	const targeted = new Set<string>();
	for (const chunk of chunkValues(keys, 10_000)) {
		const rows = await transaction
			.selectDistinct({ itemKey: publicationTarget.itemKey })
			.from(publicationTarget)
			.where(and(
				inArray(publicationTarget.itemKey, chunk),
				isNull(publicationTarget.deactivatedAt),
				isNotNull(publicationTarget.activatedAt),
			));
		for (const row of rows) targeted.add(row.itemKey);
	}
	return targeted;
}
const COLLECTION_UPSERT_CHUNK_SIZE = 1_000;

const itemColumns = getTableColumns(item);
const sourceWritableItemFields = Object.keys(itemColumns).filter(
	(field) =>
		(!LIBRARY_OWNED_PAYLOAD_FIELDS.has(field) || field === "topics") && !new Set([
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
	values.topics ??= [];
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

function preserveProtectedFileFields(
	incoming: Partial<ItemInsert>,
	existing: typeof item.$inferSelect | undefined,
	mayManageFile: boolean,
	hasManagedPublication: boolean,
) {
	if (!existing || mayManageFile) {
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

/**
 * Whether a record's values changed. The source's own modified date doesn't count on its own: OpenAlex re-dates
 * hundreds of thousands of works in bulk each night with nothing else changed, and a new revision would tell search
 * engines (sitemap date, IndexNow) that a page changed when a reader would see nothing new. The date is saved with
 * the next real change.
 */
function itemValuesDiffer(
	existing: typeof item.$inferSelect | undefined,
	next: Partial<ItemInsert>,
) {
	if (!existing) return true;
	const existingValues = existing as unknown as Record<string, unknown>;
	const nextValues = next as Record<string, unknown>;
	return sourceWritableItemFields.some(
		(field) =>
			field !== "dateModified" &&
			!databaseValueEqual(existingValues[field], nextValues[field]),
	);
}

function dirtyItemFields(
	sourceDirtyFields: readonly string[] | undefined,
	overrides: Record<string, unknown> | undefined,
) {
	return new Set([...(sourceDirtyFields ?? []), ...Object.keys(overrides ?? {})]);
}

function effectiveCollections(
	dirtyFields: ReadonlySet<string>,
	existingCollections: string[] | undefined,
	foreignCollections: string[] | undefined,
	incomingCollections: string[],
) {
	if (dirtyFields.has("collections")) return existingCollections ?? [];
	return [...new Set([...(foreignCollections ?? []), ...incomingCollections])].sort();
}

function effectiveParentItem(
	keepExisting: boolean,
	existing: typeof item.$inferSelect | undefined,
	incomingParentItem: string | null | undefined,
) {
	return keepExisting ? (existing?.parentItem ?? null) : (incomingParentItem ?? null);
}

/** Library tag edits win over source tags; foreign publications keep their tags. */
function effectiveTags(
	dirtyFields: ReadonlySet<string>,
	existingTags: string[] | undefined,
	incomingTags: string[],
	foreignPublicationTags: readonly string[] | null | undefined,
) {
	return [
		...new Set([
			...(dirtyFields.has("tags") ? (existingTags ?? []) : incomingTags),
			...(foreignPublicationTags ?? []),
		]),
	].sort();
}

function sourceSnapshotChanged(
	snapshot: Pick<typeof sourceSnapshot.$inferSelect, "payloadHash" | "mappingProfileVersion"> | undefined,
	record: SourceItemUpsert,
	mappingProfileVersion: SourceIngestionBatch["mappingProfileVersion"],
) {
	return (
		!snapshot ||
		snapshot.payloadHash !== sourceItemFingerprint(record) ||
		snapshot.mappingProfileVersion !== mappingProfileVersion
	);
}

function managedPublicationChanged(
	mayManageFile: boolean,
	record: SourceItemUpsert,
	existingPublication: typeof itemFilePublication.$inferSelect | undefined,
) {
	if (!mayManageFile) return false;
	const publication = record.file?.managedPublication;
	if (!publication) return Boolean(existingPublication);
	return (
		!existingPublication ||
		existingPublication.objectPath !== publication.objectPath ||
		existingPublication.coverObjectPath !== publication.coverObjectPath ||
		existingPublication.sizeBytes !== publication.sizeBytes ||
		existingPublication.sha256 !== publication.sha256 ||
		existingPublication.pageCount !== publication.pageCount
	);
}

function effectiveItemChanged(
	existing: typeof item.$inferSelect,
	state: { item: Partial<ItemInsert>; parentItem: string | null; tags: string[]; collections: string[] },
	existingTags: string[] | undefined,
	existingCollections: string[] | undefined,
) {
	return (
		itemValuesDiffer(existing, state.item) ||
		existing.parentItem !== state.parentItem ||
		!stringSetEqual(existingTags ?? [], state.tags) ||
		!stringSetEqual(existingCollections ?? [], state.collections)
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

/** Rows whose parent is already right are skipped, so their projection is not refreshed again. */
async function updateParents(
	transaction: Transaction,
	table: "item" | "collection",
	rows: Array<{ key: string; parentKey: string | null }>,
) {
	const column = sql.identifier(table === "item" ? "parentItem" : "parentCollection");
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
			UPDATE ${sql.identifier(table)}
			SET ${column} = CASE "key" ${cases} END
			WHERE "key" IN (${keys})
				AND ${column} IS DISTINCT FROM CASE "key" ${cases} END
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

	// A page shares search events with the search worker and other pages, so
	// PostgreSQL may roll it back to break a deadlock. The page runs again
	// from the start: everything it changes lives inside the transaction.
	return retryTransientConflicts(() => db.transaction(async (transaction) => {
		const [providerRow] = await transaction.select({ provider: sourceConnection.provider }).from(sourceConnection).where(eq(sourceConnection.key, batch.sourceConnectionKey));
		if (isOpenAlexWorkProvider(providerRow?.provider)) {
			// ponytail: serialize OpenAlex work pages per library; use work-level locks if parallel import throughput becomes necessary.
			await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('new-el:openalex-records'))`);
		}
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
		// Writes to a source take turns. The lock leaves the key alone, so PDFs
		// staged meanwhile, whose rows reference the source, are not held up.
		const lockedConnections = await transaction
			.select()
			.from(sourceConnection)
			.where(inArray(sourceConnection.key, involvedConnectionKeys))
			.orderBy(sourceConnection.key)
			.for("no key update");
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
		const openAlexWorks = isOpenAlexWorkProvider(connection.provider);
		if (lockedConnections.length !== involvedConnectionKeys.length) {
			throw new SourceReferenceNotFoundError(
				"collection",
				"source connection",
			);
		}
		if (
			(batch.expectedConfiguration && !jsonEqual(connection.config as JsonValue, batch.expectedConfiguration)) ||
			!jsonEqual(
				connection.syncCursor as JsonValue,
				batch.expectedCursor as JsonValue,
			)
		) {
			throw new SourceCursorConflictError(batch.sourceConnectionKey);
		}

		if (batch.institutionCountries.length) {
			const rows = new Map(batch.institutionCountries.map(({ name, ...facts }) => [institutionNameKey(name), facts]));
			// Four parameters a fact: one statement would pass PostgreSQL's limit of 65,535 near 16,000 facts.
			const namesByKey = new Map(batch.institutionCountries.map(({ name }) => [institutionNameKey(name), name]));
			for (const chunk of chunkValues([...rows], RELATION_CHUNK_SIZE)) {
				const added = await transaction.insert(institutionCountry).values(chunk.map(([nameKey, facts]) => ({ nameKey, ...facts }))).onConflictDoNothing().returning({ nameKey: institutionCountry.nameKey });
				// A country known for the first time also places records already here with an author at that institution.
				if (added.length) await reindexAuthorsAt(transaction, added.map(({ nameKey }) => namesByKey.get(nameKey)!), { folded: false });
			}
		}

		const collectionKeys = await reserveCollectionIdentities(transaction, {
			sourceConnectionKey: batch.sourceConnectionKey,
			sourceRecordKeys: collectionUpserts.map(
				(record) => record.sourceRecordKey,
			),
		});
		const { keys: itemKeys, joined: joinedItemKeys } = await reserveItemSourceLinks(transaction, {
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
		await updateParents(
			transaction,
			"collection",
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

		const openAlexLinks = openAlexWorks && batchItemKeys.length
			? await transaction.select({ itemKey: itemSourceLink.itemKey, remoteVersion: itemSourceLink.remoteVersion, config: sourceConnection.config, status: sourceConnection.status })
				.from(itemSourceLink).innerJoin(sourceConnection, eq(sourceConnection.key, itemSourceLink.sourceConnectionKey))
				.where(and(inArray(sourceConnection.provider, OPENALEX_WORK_PROVIDERS), inArray(itemSourceLink.itemKey, batchItemKeys)))
			: [];
		const downloadItemKeys = new Set(openAlexLinks.filter((link) => link.status !== "removed" && link.config.downloadPdfs === true).map((link) => link.itemKey));
		const mayManageFile = (record: SourceItemUpsert) => {
			const key = itemKeys.get(record.sourceRecordKey)!;
			const existing = existingItemByKey.get(key);
			const publication = existingPublicationByItemKey.get(key);
			if (openAlexWorks) {
				return Boolean(record.file?.managedPublication) || !publication || !downloadItemKeys.has(key);
			}
			return sourceOwnsCanonicalItem(existing, batch.sourceConnectionKey);
		};

		// Editorial overrides and source values exist only for OpenAlex; Zotero edits flow through writeback.
		const overridesByItem = openAlexWorks ? await sourceOverridesByItem(transaction, batchItemKeys) : new Map<string, Record<string, unknown>>();
		const previousSourceValues = openAlexWorks && batchItemKeys.length ? await transaction.select().from(itemSourceValue).where(inArray(itemSourceValue.itemKey, batchItemKeys)) : [];
		const topicImportKeys = new Set(previousSourceValues.filter(row => row.importedTopics).map(row => row.itemKey));
		const importedTopicRows = new Map<string, ReturnType<typeof importedTopics>>();
		for (const record of itemUpserts) {
			const key = itemKeys.get(record.sourceRecordKey)!;
			const existing = existingItemByKey.get(key);
			const normalized = normalizedItems.get(record.sourceRecordKey)!;
			if (openAlexWorks && !record.parentSourceRecordKey && (!existing || topicImportKeys.has(key))) {
				const assignments = importedTopics(record.raw);
				importedTopicRows.set(key, assignments);
				topicImportKeys.add(key);
				normalized.item.topics = effectiveSourceTopics(assignments);
			} else normalized.item.topics = existing?.topics ?? [];
		}

		const effectiveItemStateByRecordKey = new Map(
			itemUpserts.map((record) => {
				const key = itemKeys.get(record.sourceRecordKey)!;
				const existing = existingItemByKey.get(key);
				const dirtyFields = dirtyItemFields(
					sourceLinkByItemKey.get(key)?.dirtyFields,
					overridesByItem.get(key),
				);
				const normalized = normalizedItems.get(record.sourceRecordKey)!;
				const existingPublication =
					existingPublicationByItemKey.get(key);
				const protectsManagedPublication =
					!mayManageFile(record) && Boolean(existingPublication);
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
						sourceCollections: incomingCollections,
						collections: effectiveCollections(
							dirtyFields,
							existingCollectionsByItemKey.get(key),
							foreignCollectionsByItemKey.get(key),
							incomingCollections,
						),
						dirtyFields,
						item: preserveProtectedFileFields(
							maskDirtyItemFields(
								{ ...normalized.item, creators: preserveCreatorProfileLinks(normalized.item.creators, existing?.creators, { sourceAffiliations: openAlexWorks }) },
								existing,
								dirtyFields,
							),
							existing,
							mayManageFile(record),
							protectsManagedPublication,
						),
						parentItem: effectiveParentItem(
							protectsManagedPublication || dirtyFields.has("parentItem"),
							existing,
							parentItemKeys.get(record.sourceRecordKey),
						),
						tags: effectiveTags(
							dirtyFields,
							existingTagsByItemKey.get(key),
							normalized.tags,
							sourceOwnsCanonicalItem(existing, batch.sourceConnectionKey)
								? undefined
								: existingPublication?.publicationTags,
						),
					},
				] as const;
			}),
		);
		const newestSourceVersionByItem = new Map<string, number>();
		if (openAlexLinks.length) {
			for (const row of openAlexLinks) {
				const version = row.remoteVersion ? Date.parse(row.remoteVersion) : NaN;
				if (Number.isFinite(version)) newestSourceVersionByItem.set(row.itemKey, Math.max(version, newestSourceVersionByItem.get(row.itemKey) ?? -Infinity));
			}
		}
		const staleItemKeys = new Set(itemUpserts.flatMap((record) => {
			const key = itemKeys.get(record.sourceRecordKey)!;
			const previous = newestSourceVersionByItem.get(key);
			const incoming = record.sourceDates?.modifiedAt?.getTime() ?? Date.parse(record.remoteVersion ?? "");
			return previous !== undefined && (!Number.isFinite(incoming) || incoming < previous) ? [key] : [];
		}));
		const currentItemUpserts = itemUpserts.filter((record) => !staleItemKeys.has(itemKeys.get(record.sourceRecordKey)!));
		await writeSourceValues(transaction, batch, openAlexWorks ? currentItemUpserts : [], (record) => {
			const key = itemKeys.get(record.sourceRecordKey)!;
			const normalized = normalizedItems.get(record.sourceRecordKey)!;
			const sourceItem = {...normalized.item};
			if (!importedTopicRows.has(key)) delete sourceItem.topics;
			return {
				state: {itemKey: key, sourceConnectionKey: batch.sourceConnectionKey,
					payload: {...sourceItem, tags: normalized.tags, collections: effectiveItemStateByRecordKey.get(record.sourceRecordKey)!.sourceCollections,
						parentItem: parentItemKeys.get(record.sourceRecordKey) ?? null},
					remoteVersion: record.remoteVersion, fetchedAt: batch.fetchedAt, importedTopics: topicImportKeys.has(key)},
				topics: importedTopicRows.get(key)?.map(topic => ({...topic, itemKey: key,
					sourceConnectionKey: batch.sourceConnectionKey, sourceVersion: record.remoteVersion, fetchedAt: batch.fetchedAt})),
			};
		});
		const changedItemUpserts = currentItemUpserts.filter((record) => {
			const key = itemKeys.get(record.sourceRecordKey)!;
			const existing = existingItemByKey.get(key);
			if (!existing) return true;
			if (existing.deleted === 1) {
				return (
					(openAlexWorks || existing.sourceConnectionKey === batch.sourceConnectionKey) && !overridesByItem.get(key)?.deleted
				);
			}
			const sourceChanged = sourceSnapshotChanged(
				snapshotByItemKey.get(key),
				record,
				batch.mappingProfileVersion,
			);
			const state = effectiveItemStateByRecordKey.get(
				record.sourceRecordKey,
			)!;
			const publicationChanged = managedPublicationChanged(
				mayManageFile(record),
				record,
				existingPublicationByItemKey.get(key),
			);
			if (!sourceChanged) return publicationChanged;
			return (
				effectiveItemChanged(
					existing,
					state,
					existingTagsByItemKey.get(key),
					existingCollectionsByItemKey.get(key),
				) || publicationChanged
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
		await updateParents(
			transaction,
			"item",
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
				!mayManageFile(record)
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
			if (openAlexWorks && !publication.staged && !sameContent) {
				throw new SourceFileStagingConflictError(batch.sourceConnectionKey, [publication.objectPath, publication.coverObjectPath]);
			}
			return [
				{
					itemKey,
					sourceConnectionKey: sameContent ? previous.sourceConnectionKey : batch.sourceConnectionKey,
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
					return mayManageFile(record) && !record.file?.managedPublication
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
					inArray(sourceFileCleanup.objectPath, [...activePublicationPaths]),
				)
				.returning({ objectPath: sourceFileCleanup.objectPath, sourceConnectionKey: sourceFileCleanup.sourceConnectionKey });
			const consumedPaths = new Set(
				consumedStagingRows.filter((row) => row.sourceConnectionKey === batch.sourceConnectionKey).map(({ objectPath }) => objectPath),
			);
			const missingStagedPaths = changedItemUpserts.flatMap((record) => {
				if (!mayManageFile(record)) {
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
		const citationMetricUpserts = currentItemUpserts.flatMap((record) => {
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
			if (!itemKey || staleItemKeys.has(itemKey) || !citationMetricByItemKey.has(itemKey)) return [];
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
		// target resolves in this library. OpenAlex keeps unresolved references
		// so importing a target from another query can complete them later.
		const citationTargetsByRecordKey = new Map(
			currentItemUpserts
				.filter((record) => !record.parentSourceRecordKey)
				.map((record) => [
					record.sourceRecordKey,
					record.referencedSourceRecordKeys,
				] as const),
		);
		const citationSourceKeys = [
			...new Set([...citationTargetsByRecordKey.values()].flat()),
		].filter((key) => !itemKeys.has(key));
		const citationIdentity = openAlexWorks && citationSourceKeys.length ? new Map((await transaction.select({record: itemSourceLink.sourceRecordKey, key: itemSourceLink.itemKey})
            .from(itemSourceLink).innerJoin(sourceConnection, eq(sourceConnection.key, itemSourceLink.sourceConnectionKey))
            .where(and(inArray(sourceConnection.provider, OPENALEX_WORK_PROVIDERS), inArray(itemSourceLink.sourceRecordKey, citationSourceKeys)))).map(row => [row.record, row.key])) : await loadIdentityMap(
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
		// Zotero sends no references; its citations are read from the stored library once the sync's last batch is in.
		let citationLinkChange: { changedItemKeys: string[] } =
			connection.provider === "zotero"
				? { changedItemKeys: [] }
				: openAlexWorks
					? {
							changedItemKeys: await updateOpenAlexReferences(
								transaction,
								batch.sourceConnectionKey,
								currentItemUpserts,
								itemKeys,
							),
						}
					: await replaceSourceLinks(transaction, {
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
			if (staleItemKeys.has(itemKey) && snapshotByItemKey.has(itemKey)) return [];
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
		// The open-access label reads the newest stored copy of an OpenAlex work, so a copy that changed, or became the
		// newest one, can change it: those records are indexed again.
		const openAccessBefore = await readOpenAccess(transaction, batchItemKeys);
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
				if (!itemKey) return [];
				const link = sourceLinkByItemKey.get(itemKey);
				const existing = existingItemByKey.get(itemKey);
				const remoteDeleted = record.operation === "delete";
				const acknowledged =
					(link?.dirtyFields.length ?? 0) === 0 &&
					(!remoteDeleted ||
						existing?.sourceConnectionKey ===
							batch.sourceConnectionKey);
				return [
					{
						acknowledged,
						itemKey,
						remoteDeleted,
						remoteVersion: staleItemKeys.has(itemKey) && link?.remoteVersion ? link.remoteVersion : record.remoteVersion,
					},
				];
			}),
			now,
		);
		// After the links too: a withdrawn or returning link decides whether its copy counts.
		const openAccessAfter = await readOpenAccess(transaction, batchItemKeys);
		const openAccessChangedItemKeys = batchItemKeys.filter(
			(key) => openAccessBefore(key, null) !== openAccessAfter(key, null),
		);
		// Readers filter by the sources that hold a record, so a record this source took up, let go or took back is
		// indexed again.
		const sourcesChangedItemKeys = batch.items.flatMap((record) => {
			const itemKey = itemKeys.get(record.sourceRecordKey);
			if (!itemKey) return [];
			const link = sourceLinkByItemKey.get(itemKey);
			const heldBefore = !joinedItemKeys.has(itemKey) && Boolean(link && !link.remoteDeleted);
			return heldBefore === (record.operation !== "delete") ? [] : [itemKey];
		});
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
		// After the source links record what the source deleted. A batch that leaves work pending is not the last one.
		const pending = (batch.nextCursor as { pending?: unknown }).pending;
		if (connection.provider === "zotero" && !pending) {
			citationLinkChange = await replaceZoteroCitationLinks(transaction, {
				key: connection.key,
				scopeKind: connection.scopeKind,
				externalScopeKey: connection.externalScopeKey,
			});
		}

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
		for (const key of citationMetricChangedItemKeys) affectedParentKeys.add(key);
		for (const key of openAccessChangedItemKeys) affectedParentKeys.add(key);
		// A new link changes both records' public pages but neither record, so
		// records outside this batch are queued for search again instead of
		// taking a new revision. In a large import that is thousands of records
		// a page. Records with a publication target still take one, so their
		// deposits are updated.
		const linkedKeys = [...new Set([...relatedLinkChange.changedItemKeys, ...citationLinkChange.changedItemKeys])]
			.filter((key) => !directlyChangedItemKeys.has(key) && !affectedParentKeys.has(key));
		const depositedLinkedKeys = await publicationTargetedKeys(transaction, linkedKeys);
		for (const key of depositedLinkedKeys) affectedParentKeys.add(key);
		// Which sources hold a record is part of neither the record nor its deposits, so it is only searched again.
		const leasedLinkedKeys = await requeueLinkedRecords(
			transaction,
			[...linkedKeys.filter((key) => !depositedLinkedKeys.has(key)), ...sourcesChangedItemKeys],
			new Set([...directlyChangedItemKeys, ...affectedParentKeys]),
			now,
			batch.sourceSyncRunId ?? null,
		);
		for (const key of leasedLinkedKeys) affectedParentKeys.add(key);
		const parentKeysToBump = [...affectedParentKeys]
			.filter((key) => !directlyChangedItemKeys.has(key))
			.sort();
		// A large library's first citation read can reach tens of thousands of records: keep each statement under
		// PostgreSQL's limit of 65,535 parameters.
		const byChunk = async <Row,>(keys: string[], read: (chunk: string[]) => Promise<Row[]>) => {
			const rows: Row[] = [];
			for (const chunk of chunkValues(keys, 10_000)) rows.push(...(await read(chunk)));
			return rows;
		};
		if (parentKeysToBump.length > 0) {
			// Links and citations can reach records outside this batch; hold their mutation locks like the batch's own.
			await lockItemMutations(transaction, parentKeysToBump);
			const bumpedParents = await byChunk(parentKeysToBump, (chunk) =>
				transaction
					.update(item)
					.set({
						revision: sql`${item.revision} + 1`,
						updatedAt: now,
					})
					.where(and(inArray(item.key, chunk), eq(item.deleted, 0)))
					.returning({
						key: item.key,
						revision: item.revision,
					}),
			);
			for (const parent of bumpedParents) {
				itemEvents.set(parent.key, {
					operation: "upsert",
					revision: parent.revision,
				});
			}
		}

		const changedRows = await byChunk([...itemEvents.keys()], (chunk) =>
			transaction
				.select({
					deleted: item.deleted,
					key: item.key,
					parentItem: item.parentItem,
					revision: item.revision,
				})
				.from(item)
				.where(inArray(item.key, chunk)),
		);
		const changedParentKeys = [
			...new Set(
				changedRows.flatMap((row) => {
					if (row.parentItem) return [row.parentItem];
					return row.deleted === 0 ? [row.key] : [];
				}),
			),
		].sort();
		const changedParents = await byChunk(changedParentKeys, (chunk) =>
			transaction
				.select({ key: item.key, revision: item.revision })
				.from(item)
				.where(and(inArray(item.key, chunk), eq(item.deleted, 0)))
				.orderBy(item.key),
		);
		const fileChangedParentKeys = new Set([
			...publicationUpserts.map(({ parentItemKey }) => parentItemKey),
			...publicationDeleteItemKeys.flatMap((itemKey) => {
				const parentItemKey =
					existingPublicationByItemKey.get(itemKey)?.parentItemKey;
				return parentItemKey ? [parentItemKey] : [];
			}),
		]);
		// Most imported records have no publication target, so find the ones that do in one read.
		const targetedParentKeys = await publicationTargetedKeys(transaction, changedParents.map((parent) => parent.key));
		for (const parent of changedParents.filter((row) => targetedParentKeys.has(row.key))) {
			await enqueuePublicationJobsForItem(transaction, {
				itemKey: parent.key,
				canonicalRevision: parent.revision,
				reason: fileChangedParentKeys.has(parent.key)
					? "file_changed"
					: "record_changed",
				now,
			});
		}

		const sourceSyncRunId = batch.sourceSyncRunId ?? null;
		const outboxRows = [
			...[...collectionEvents].map(
				([entityKey, { operation, revision }]) => ({
					entityType: "collection" as const,
					entityKey,
					operation,
					revision,
					sourceSyncRunId,
				}),
			),
			...[...itemEvents].map(([entityKey, { operation, revision }]) => ({
				entityType: "item" as const,
				entityKey,
				operation,
				revision,
				sourceSyncRunId,
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
	}));
}
