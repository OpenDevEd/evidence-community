import { resolveCountryFocus } from "@/lib/country-focus";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { sourceConnection } from "@opendeved/evidence-library-core";

import {
	isPublicTopLevelItem,
	LIBRARY_OWNED_PAYLOAD_FIELDS,
} from "@/lib/admin/item-fields";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import {
	type DatabaseTransaction,
	withCancellableDatabaseTransaction,
} from "@/db/cancellable-transaction";
import { collection } from "@/db/schema/tables/collection";
import { item } from "@/db/schema/tables/item";
import { itemInstitution } from "@/db/schema/tables/itemInstitution";
import {
	INSTITUTION_FILTER_FIELD,
	institutionNameKey,
} from "@/config/library-config/institutions";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { chunkValues } from "@/lib/chunk-values";
import { getSourceCitationMetricsForKeys } from "@/lib/links/citation-metrics";
import { getPublicItemLinksForKeys } from "@/lib/links/item-links";
import { filterPublicAttachments, hasAnyTag } from "@/lib/tags";
import type { Item } from "@/app/api/item/types";
import { bibliographicDateSearchFields } from "@/lib/bibliographic-date";
import { resolvePublicDoi } from "@/lib/publication/publication-identifier-summary";
import { readPublicIdentifiers } from "@/lib/publication/public-identifiers";

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

type CollectionRow = Pick<typeof collection.$inferSelect, "key" | "parentCollection" | "deleted">;
type ItemRow = typeof item.$inferSelect;
export type PublicationProjectionConfig = LibraryServerConfig["services"]["publication"];

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

function institutionNamesByItem(
	rows: readonly { itemKey: string; institutionName: string }[],
) {
	const names = new Map<string, string[]>();
	for (const row of rows)
		names.set(row.itemKey, [
			...(names.get(row.itemKey) ?? []),
			row.institutionName,
		]);
	return (itemKey: string) => names.get(itemKey) ?? [];
}

function cleanRow(row: ItemRow) {
	return Object.fromEntries(
		Object.entries(row)
			.filter(
				([field, value]) =>
					!LIBRARY_OWNED_PAYLOAD_FIELDS.has(field) &&
					value !== null &&
					value !== undefined &&
					value !== "",
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
	publication: PublicationProjectionConfig,
	topLevelKeys: readonly string[],
	collections: readonly CollectionRow[],
	hiddenTags: readonly string[] = [],
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
		identifiersByItem,
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
					readPublicIdentifiers(database, activeParents.map(({ item }) => item), publication),
				])
			: [[], [], [], new Map()];

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
	// The record's own institutions, and those plus its authors' affiliations.
	const institutionsOf = institutionNamesByItem(
		institutionRows.filter((row) => row.source === "record"),
	);
	const connectedInstitutionsOf = institutionNamesByItem(institutionRows);
	const [linksByItem, citationMetricsByItem] = await Promise.all([
		getPublicItemLinksForKeys(database, activeParentKeys, { hiddenTags }),
		getSourceCitationMetricsForKeys(database, activeParentKeys),
	]);
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
			const parentChildren = childrenByParent.get(parent.key) ?? [];
			const attachments = parentChildren.map(
				(child) => ({
					...cleanRow({
						...child,
						fullTextPDF: null,
					}),
					tags: uniqueSorted(tagsByItem.get(child.key) ?? []),
				}),
			);
			const fullTextPDFs = parentChildren
				.filter((child) => child.deleted !== 1)
				.map((child) => ({
					key: child.key,
					fullTextPDF: fullTextPages(child.fullTextPDF),
				}))
				.filter((entry) => entry.fullTextPDF.length > 0);
			const publicationIdentifiers = identifiersByItem.get(parent.key);

			return {
				...cleanRow(parent),
				DOI: resolvePublicDoi({
					...parent, publicationIdentifiers,
					attachments: parentChildren.filter(child => child.deleted !== 1 && !hasAnyTag(tagsByItem.get(child.key), hiddenTags))
						.map(child => ({ url: child.url, tags: tagsByItem.get(child.key) })),
				}),
				...bibliographicDateSearchFields(parent.date),
				attachmentsData: attachments,
				citationMetrics: citationMetricsByItem.get(parent.key) ?? [],
				collections: directCollections,
				collectionsAncestry: collectionAncestry(
					directCollections,
					collectionsByKey,
				),
				country: resolveCountryFocus(parent),
				deleted: parent.deleted ?? 0,
				fullNames: creatorNames(parent.creators),
				fullTextPDFs,
				institution: institutionsOf(parent.key),
				// A name on the record and on an author is one facet value.
				[INSTITUTION_FILTER_FIELD]: [
					...new Map(
						connectedInstitutionsOf(parent.key).map((name) => [
							institutionNameKey(name),
							name,
						]),
					).values(),
				],
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
	publication: PublicationProjectionConfig,
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
					publication,
					keyChunk,
					collections,
				),
		);
	}
}

export async function* generateSearchProjectionPlans(
	database: Database,
	publication: PublicationProjectionConfig,
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
	yield* plansForKeys(database, publication, topLevelKeys, collections, batchSize, signal);
}

export async function* generateFullSearchProjectionPlans(
	database: Database,
	publication: PublicationProjectionConfig,
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
		publication,
		topLevelRows.map(({ key }) => key),
		collections,
		batchSize,
		signal,
	);
}

/** Read the committed record with the same metadata projection used by search. */
export async function readPublicItem(
	database: Database,
	key: string,
	config: LibraryServerConfig,
): Promise<Item | null> {
	return (await readPublicItems(database, [key], config))[0] ?? null;
}

/**
 * Several committed records in one read, in the order given. Records that are
 * not public are left out, so a page of cards costs one projection, not one each.
 */
export async function readPublicItems(
	database: Database,
	keys: readonly string[],
	config: LibraryServerConfig,
): Promise<Item[]> {
	if (!keys.length) return [];
	return database.transaction(async (transaction) => {
		const { rows: collections } = await transaction.execute<CollectionRow>(sql`
			WITH RECURSIVE ancestors AS (
				SELECT current.key, current."parentCollection", current.deleted
				FROM ${collection} current
				JOIN ${itemToCollection} membership ON membership."collectionKey" = current.key
				WHERE membership."itemKey" IN (${sql.join(keys.map((key) => sql`${key}`), sql`, `)})
				UNION
				SELECT parent.key, parent."parentCollection", parent.deleted
				FROM ${collection} parent
				JOIN ancestors child ON parent.key = child."parentCollection"
			)
			SELECT * FROM ancestors
		`);
		const plan = await buildSearchProjectionPlanForKeys(transaction, config.services.publication, keys, collections, config.content.tags.hidden);
		const documents = new Map(plan.documents.map((document) => [document.key, document]));
		return keys.flatMap((key) => {
			const document = documents.get(key);
			if (!document || hasAnyTag(document.tags, config.content.tags.hidden)) return [];
			const result = document as Item;
			result.attachmentsData = filterPublicAttachments(result.attachmentsData, config.content.tags);
			const attachmentKeys = new Set(result.attachmentsData?.map((attachment) => attachment.key));
			result.fullTextPDFs = result.fullTextPDFs?.filter((attachment) => attachmentKeys.has(attachment.key));
			return [result];
		});
	}, { isolationLevel: "repeatable read", accessMode: "read only" });
}
