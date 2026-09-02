import { sourceConnection } from "@opendeved/evidence-library-core";

import { isPublicTopLevelItem } from "@/lib/admin/item-fields";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import {
	type DatabaseTransaction,
	withCancellableDatabaseTransaction,
} from "@/db/cancellable-transaction";
import { collection } from "@/db/schema/tables/collection";
import {
	publicationIdentifier,
	publicationSyncState,
} from "@/db/schema/publication";
import { item } from "@/db/schema/tables/item";
import { itemInstitution } from "@/db/schema/tables/itemInstitution";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { chunkValues } from "@/lib/chunk-values";
import { getPublicItemLinksForKeys } from "@/lib/links/item-links";
import { bibliographicDateSearchFields } from "@/lib/bibliographic-date";
import { buildPublicationIdentifierSummary } from "@/lib/publication/publication-identifier-summary";

export type SearchProjectionEvent = {
	entityKey: string;
	entityType: "collection" | "item";
};

export type ItemSearchDocument = Record<string, unknown> & {
	collections: string[];
	collectionsAncestry: string[];
	deleted: number;
	key: string;
	provider: string;
	revision: number;
	sourceConnectionKey: string;
	sourceExternalScopeKey: string | null;
	sourceRecordKey: string;
	tags: string[];
};

export type SearchProjectionPlan = {
	deleteKeys: string[];
	documents: ItemSearchDocument[];
};

type CollectionRow = typeof collection.$inferSelect;
type ItemRow = typeof item.$inferSelect;
type SearchProjectionDatabase = Pick<Database | DatabaseTransaction, "select">;

function uniqueSorted(values: Iterable<string>) {
	return [...new Set(values)].sort();
}

function descendantsOf(
	rootKeys: Iterable<string>,
	collections: readonly CollectionRow[],
) {
	const children = new Map<string, string[]>();
	for (const row of collections) {
		if (!row.parentCollection) continue;
		const siblings = children.get(row.parentCollection) ?? [];
		siblings.push(row.key);
		children.set(row.parentCollection, siblings);
	}

	const output = new Set<string>();
	const pending = [...rootKeys];
	while (pending.length > 0) {
		const key = pending.pop()!;
		if (output.has(key)) continue;
		output.add(key);
		pending.push(...(children.get(key) ?? []));
	}
	return output;
}

function collectionAncestry(
	directKeys: readonly string[],
	collectionsByKey: ReadonlyMap<string, CollectionRow>,
) {
	const output = new Set<string>();
	for (const directKey of directKeys) {
		let currentKey: string | null = directKey;
		const path = new Set<string>();
		while (currentKey) {
			if (path.has(currentKey)) {
				throw new Error(
					`Collection hierarchy contains a cycle at ${currentKey}`,
				);
			}
			path.add(currentKey);
			const current = collectionsByKey.get(currentKey);
			if (!current) break;
			if (current.deleted !== 1) output.add(current.key);
			currentKey = current.parentCollection;
		}
	}
	return uniqueSorted(output);
}

function splitValues(value: string | null) {
	return value
		? uniqueSorted(
				value
					.split("|")
					.map((entry) => entry.trim())
					.filter(Boolean),
			)
		: [];
}

function creatorNames(creators: ItemRow["creators"]) {
	return uniqueSorted(
		(creators ?? [])
			.map(
				(creator) =>
					creator.name?.trim() ||
					[creator.firstName, creator.lastName]
						.filter(Boolean)
						.join(" ")
						.trim(),
			)
			.filter(Boolean),
	);
}

function fullTextPages(value: string | null) {
	if (!value?.trim()) return [];
	const pages: Array<{ page: number; text: string }> = [];
	const pagePattern =
		/\*\*\|\|\s*PAGE\s+(\d+)\s*\|\|\*\*([\s\S]*?)(?=\*\*\|\|\s*PAGE\s+\d+\s*\|\|\*\*|$)/giu;
	for (const match of value.matchAll(pagePattern)) {
		const text = match[2]?.trim();
		if (text) pages.push({ page: Number(match[1]), text });
	}
	return pages.length > 0 ? pages : [{ page: 1, text: value.trim() }];
}

function jsonValue(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(jsonValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.filter(
					([, child]) =>
						child !== null && child !== undefined && child !== "",
				)
				.map(([key, child]) => [key, jsonValue(child)]),
		);
	}
	return value;
}

function cleanRow(row: ItemRow) {
	return Object.fromEntries(
		Object.entries(row)
			.filter(
				([, value]) =>
					value !== null && value !== undefined && value !== "",
			)
			.map(([key, value]) => [key, jsonValue(value)]),
	);
}

const NON_METADATA_SEARCH_FIELDS = new Set([
	"PDFCoverPageImage",
	"citation",
	"createdAt",
	"deleted",
	"deletedAt",
	"fullTextPDF",
	"key",
	"revision",
	"sourceConnectionKey",
	"sourceRecordKey",
	"updatedAt",
]);

function searchableValues(value: unknown): string[] {
	if (typeof value === "string") return value.trim() ? [value.trim()] : [];
	if (typeof value === "number" || typeof value === "boolean") {
		return [String(value)];
	}
	if (Array.isArray(value)) return value.flatMap(searchableValues);
	if (value && typeof value === "object") {
		return Object.values(value).flatMap(searchableValues);
	}
	return [];
}

function metadataSearchValues(row: ItemRow) {
	return uniqueSorted(
		Object.entries(cleanRow(row)).flatMap(([field, value]) =>
			NON_METADATA_SEARCH_FIELDS.has(field)
				? []
				: searchableValues(value),
		),
	);
}

async function resolveTopLevelItemKeys(
	database: SearchProjectionDatabase,
	events: readonly SearchProjectionEvent[],
	collections: readonly CollectionRow[],
) {
	const requestedItemKeys = new Set(
		events
			.filter((event) => event.entityType === "item")
			.map((event) => event.entityKey),
	);
	const collectionEventKeys = events
		.filter((event) => event.entityType === "collection")
		.map((event) => event.entityKey);
	if (collectionEventKeys.length > 0) {
		const affectedCollections = descendantsOf(
			collectionEventKeys,
			collections,
		);
		for (const collectionChunk of chunkValues(
			[...affectedCollections],
			1_000,
		)) {
			const memberships = await database
				.select({ itemKey: itemToCollection.itemKey })
				.from(itemToCollection)
				.where(
					inArray(itemToCollection.collectionKey, collectionChunk),
				);
			for (const membership of memberships) {
				requestedItemKeys.add(membership.itemKey);
			}
		}
	}
	if (requestedItemKeys.size === 0) return [];

	const rows: Array<{ key: string; parentItem: string | null }> = [];
	for (const itemChunk of chunkValues([...requestedItemKeys], 1_000)) {
		rows.push(
			...(await database
				.select({
					key: item.key,
					parentItem: item.parentItem,
				})
				.from(item)
				.where(inArray(item.key, itemChunk))),
		);
	}
	const rowByKey = new Map(rows.map((row) => [row.key, row]));
	return uniqueSorted(
		[...requestedItemKeys].flatMap((key) => {
			const parentItem = rowByKey.get(key)?.parentItem;
			return parentItem ? [key, parentItem] : [key];
		}),
	);
}

async function buildSearchProjectionPlanForKeys(
	database: SearchProjectionDatabase,
	topLevelKeys: readonly string[],
	collections: readonly CollectionRow[],
): Promise<SearchProjectionPlan> {
	if (topLevelKeys.length === 0) {
		return { deleteKeys: [], documents: [] };
	}

	const itemRows = await database
		.select({
			item,
			provider: sourceConnection.provider,
			sourceExternalScopeKey: sourceConnection.externalScopeKey,
		})
		.from(item)
		.innerJoin(
			sourceConnection,
			eq(item.sourceConnectionKey, sourceConnection.key),
		)
		.where(inArray(item.key, topLevelKeys))
		.orderBy(asc(item.key));
	const activeParents = itemRows.filter(
		(row) => isPublicTopLevelItem(row.item) && row.item.deleted !== 1,
	);
	const activeParentKeys = activeParents.map(({ item }) => item.key);
	const children =
		activeParentKeys.length > 0
			? await database
					.select()
					.from(item)
					.where(inArray(item.parentItem, activeParentKeys))
					.orderBy(asc(item.key))
			: [];
	const allDocumentItemKeys = [
		...activeParentKeys,
		...children.map((child) => child.key),
	];
	const [
		tagRows,
		membershipRows,
		institutionRows,
		identifierRows,
		zenodoStateRows,
	] =
		allDocumentItemKeys.length > 0
			? await Promise.all([
					database
						.select()
						.from(itemToTag)
						.where(inArray(itemToTag.itemKey, allDocumentItemKeys))
						.orderBy(
							asc(itemToTag.itemKey),
							asc(itemToTag.tagName),
						),
					database
						.select()
						.from(itemToCollection)
						.where(
							inArray(itemToCollection.itemKey, activeParentKeys),
						)
						.orderBy(
							asc(itemToCollection.itemKey),
							asc(itemToCollection.collectionKey),
						),
					database
						.select()
						.from(itemInstitution)
						.where(
							inArray(itemInstitution.itemKey, activeParentKeys),
						)
						.orderBy(
							asc(itemInstitution.itemKey),
							asc(itemInstitution.institutionName),
						),
					database
						.select({
							doi: publicationIdentifier.doi,
							itemKey: publicationIdentifier.itemKey,
							lifecycle: publicationIdentifier.lifecycle,
							ownership: publicationIdentifier.ownership,
							registrar: publicationIdentifier.registrar,
							role: publicationIdentifier.role,
						})
						.from(publicationIdentifier)
						.where(
							and(
								inArray(
									publicationIdentifier.itemKey,
									activeParentKeys,
								),
								eq(publicationIdentifier.isCurrent, true),
							),
						)
						.orderBy(
							asc(publicationIdentifier.itemKey),
							asc(publicationIdentifier.registrar),
							asc(publicationIdentifier.role),
						),
					database
						.select({
							itemKey: publicationSyncState.itemKey,
							zenodoParentId: publicationSyncState.zenodoParentId,
							zenodoRecordId: publicationSyncState.zenodoRecordId,
						})
						.from(publicationSyncState)
						.where(
							and(
								inArray(
									publicationSyncState.itemKey,
									activeParentKeys,
								),
								eq(publicationSyncState.provider, "zenodo"),
								eq(publicationSyncState.environment, "sandbox"),
							),
						),
				])
			: [[], [], [], [], []];

	const tagsByItem = new Map<string, string[]>();
	for (const row of tagRows) {
		const tags = tagsByItem.get(row.itemKey) ?? [];
		tags.push(row.tagName);
		tagsByItem.set(row.itemKey, tags);
	}
	const collectionsByItem = new Map<string, string[]>();
	for (const row of membershipRows) {
		const keys = collectionsByItem.get(row.itemKey) ?? [];
		keys.push(row.collectionKey);
		collectionsByItem.set(row.itemKey, keys);
	}
	const institutionsByItem = new Map<string, string[]>();
	for (const row of institutionRows) {
		const names = institutionsByItem.get(row.itemKey) ?? [];
		names.push(row.institutionName);
		institutionsByItem.set(row.itemKey, names);
	}
	const identifiersByItem = new Map<
		string,
		Array<(typeof identifierRows)[number]>
	>();
	for (const row of identifierRows) {
		const identifiers = identifiersByItem.get(row.itemKey) ?? [];
		identifiers.push(row);
		identifiersByItem.set(row.itemKey, identifiers);
	}
	const zenodoStateByItem = new Map(
		zenodoStateRows.map((row) => [row.itemKey, row]),
	);
	// Record links are a projection here: the item API re-reads them from PostgreSQL.
	const linksByItem = await getPublicItemLinksForKeys(
		database,
		activeParentKeys,
	);
	const childrenByParent = new Map<string, ItemRow[]>();
	for (const child of children) {
		if (!child.parentItem) continue;
		const siblings = childrenByParent.get(child.parentItem) ?? [];
		siblings.push(child);
		childrenByParent.set(child.parentItem, siblings);
	}
	const collectionsByKey = new Map(collections.map((row) => [row.key, row]));

	const documents = activeParents.map(
		({ item: parent, provider, sourceExternalScopeKey }) => {
			const directCollections = uniqueSorted(
				collectionsByItem.get(parent.key) ?? [],
			);
			const attachments = (childrenByParent.get(parent.key) ?? []).map(
				(child) => ({
					...cleanRow({
						...child,
						fullTextPDF: null,
					}),
					tags: uniqueSorted(tagsByItem.get(child.key) ?? []),
				}),
			);
			const fullTextPDFs = (childrenByParent.get(parent.key) ?? [])
				.filter((child) => child.deleted !== 1)
				.map((child) => ({
					key: child.key,
					fullTextPDF: fullTextPages(child.fullTextPDF),
				}))
				.filter((entry) => entry.fullTextPDF.length > 0);
			const zenodoState = zenodoStateByItem.get(parent.key);
			const publicationIdentifiers = buildPublicationIdentifierSummary({
				identifiers: identifiersByItem.get(parent.key) ?? [],
				zenodoState: zenodoState
					? {
							environment: "sandbox",
							zenodoParentId: zenodoState.zenodoParentId,
							zenodoRecordId: zenodoState.zenodoRecordId,
						}
					: null,
			});

			return {
				...cleanRow(parent),
				...bibliographicDateSearchFields(parent.date),
				attachmentsData: attachments,
				collections: directCollections,
				collectionsAncestry: collectionAncestry(
					directCollections,
					collectionsByKey,
				),
				country: splitValues(parent.country),
				deleted: parent.deleted ?? 0,
				fullNames: creatorNames(parent.creators),
				fullTextPDFs,
				institution: institutionsByItem.get(parent.key) ?? [],
				links: linksByItem.get(parent.key) ?? {
					cites: [],
					citedBy: [],
					related: [],
				},
				metadataSearch: metadataSearchValues(parent),
				key: parent.key,
				provider,
				...(publicationIdentifiers ? { publicationIdentifiers } : {}),
				revision: parent.revision,
				sourceConnectionKey: parent.sourceConnectionKey,
				sourceExternalScopeKey,
				sourceRecordKey: parent.sourceRecordKey,
				tags: uniqueSorted(tagsByItem.get(parent.key) ?? []),
			} satisfies ItemSearchDocument;
		},
	);
	const documentKeys = new Set(documents.map((document) => document.key));
	return {
		deleteKeys: topLevelKeys.filter((key) => !documentKeys.has(key)),
		documents,
	};
}

async function* plansForKeys(
	database: Database,
	topLevelKeys: readonly string[],
	collections: readonly CollectionRow[],
	batchSize: number,
	signal?: AbortSignal,
) {
	for (const keyChunk of chunkValues([...topLevelKeys], batchSize)) {
		yield withCancellableDatabaseTransaction(
			database,
			signal,
			(transaction) =>
				buildSearchProjectionPlanForKeys(
					transaction,
					keyChunk,
					collections,
				),
		);
	}
}

export async function* generateSearchProjectionPlans(
	database: Database,
	events: readonly SearchProjectionEvent[],
	batchSize = 500,
	signal?: AbortSignal,
) {
	if (
		!Number.isSafeInteger(batchSize) ||
		batchSize < 1 ||
		batchSize > 1_000
	) {
		throw new Error(
			"projection batchSize must be an integer between 1 and 1,000",
		);
	}
	const { collections, topLevelKeys } =
		await withCancellableDatabaseTransaction(
			database,
			signal,
			async (transaction) => {
				const collections = await transaction
					.select()
					.from(collection)
					.orderBy(asc(collection.key));
				return {
					collections,
					topLevelKeys: await resolveTopLevelItemKeys(
						transaction,
						events,
						collections,
					),
				};
			},
		);
	yield* plansForKeys(database, topLevelKeys, collections, batchSize, signal);
}

export async function* generateFullSearchProjectionPlans(
	database: Database,
	batchSize = 500,
	signal?: AbortSignal,
) {
	const { collections, topLevelRows } =
		await withCancellableDatabaseTransaction(
			database,
			signal,
			async (transaction) => ({
				collections: await transaction
					.select()
					.from(collection)
					.orderBy(asc(collection.key)),
				topLevelRows: await transaction
					.select({ key: item.key })
					.from(item)
					.where(isNull(item.parentItem))
					.orderBy(asc(item.key)),
			}),
		);
	yield* plansForKeys(
		database,
		topLevelRows.map(({ key }) => key),
		collections,
		batchSize,
		signal,
	);
}
