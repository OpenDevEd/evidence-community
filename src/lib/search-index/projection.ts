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
import { institutionCountry } from "@/db/schema/tables/institutionCountry";
import {
	INSTITUTION_FILTER_FIELD,
	institutionNameKey,
} from "@/config/library-config/institutions";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { itemReading } from "@/db/schema/readings";
import { studyReadingOf } from "@/lib/readings/reading";
import { SURE, UNCERTAIN } from "@/lib/readings/study-types";
import { contentHashOf, readingText } from "@/lib/readings/reading-text";
import type { StudyTypeKey } from "@/lib/readings/study-types";
import { chunkValues } from "@/lib/chunk-values";
import { getSourceCitationMetricsForKeys } from "@/lib/links/citation-metrics";
import { readOpenAccess } from "./open-access";
import { readItemSources } from "./item-sources";
import { getPublicItemLinksForKeys } from "@/lib/links/item-links";
import { filterPublicAttachments } from "@/lib/attachment-visibility";
import { hasAnyTag, publicTagRules } from "@/lib/tags";
import { isVisiblePdfAttachment } from "@/lib/attachment-visibility";
import { PDF_PRESENCE_ATTRIBUTE, SOURCES_FIELD } from "@/lib/search-filter-constants";
import type { Item } from "@/app/api/item/types";
import { bibliographicDateSearchFields } from "@/lib/bibliographic-date";
import { resolvePublicDoi } from "@/lib/publication/publication-identifier-summary";
import { readPublicIdentifiers } from "@/lib/publication/public-identifiers";
import { resolveTopicAncestry } from "@/lib/topics/catalog";

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
	topicAncestors: string[];
	topics: string[];
};

export type SearchProjectionPlan = {
	deleteKeys: string[];
	documents: ItemSearchDocument[];
	/**
	 * The removed keys that are records' own, for telling search engines whose pages are gone. A child's key is cleared
	 * from the index too, but a child has no page. Only the projection sets it; a hand-made plan has none to tell.
	 */
	removedRecordKeys?: string[];
};

type CollectionRow = Pick<
	typeof collection.$inferSelect,
	"key" | "parentCollection" | "deleted"
>;
type ItemRow = typeof item.$inferSelect;
type SearchProjectionDatabase = Pick<Database | DatabaseTransaction, "select">;

/**
 * A record's study type for its search document: an editor's correction, else its reading while that was made from the
 * text the record has now; none until either.
 */
function readingFields(row: (Parameters<typeof studyReadingOf>[0] & { contentHash: string }) | undefined, record: ItemRow) {
	const current = row?.contentHash === contentHashOf(readingText(record.title, record.abstractNote)) ? row : undefined;
	const reading = studyReadingOf(current, record.studyType);
	if (!reading) return {};
	// The type as a library that shows uncertain types apart counts and filters it.
	const studyTypeShown = reading.by === "ai" && reading.confidence < SURE ? UNCERTAIN : reading.type;
	return { studyType: reading.type, studyTypeShown, reading };
}

export function uniqueSorted(values: Iterable<string>) {
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

/** The name a record's author is searched and filtered by: its full name, else its first and last names. */
export function creatorFullName(creator: { name?: string | null; firstName?: string | null; lastName?: string | null }) {
	return creator.name?.trim() || [creator.firstName, creator.lastName].filter(Boolean).join(" ").trim();
}

export function creatorNames(creators: ItemRow["creators"]) {
	return uniqueSorted((creators ?? []).map(creatorFullName).filter(Boolean));
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

/**
 * The countries of each record's authors' affiliations, as two-letter codes: an affiliation's country is the one the
 * library holds for its institution name (from OpenAlex, or set by an editor). A name with no known country adds none.
 */
async function authorCountriesByItem(
	database: SearchProjectionDatabase,
	rows: readonly { itemKey: string; institutionName: string }[],
) {
	const keys = [...new Set(rows.map((row) => institutionNameKey(row.institutionName)))];
	const known = new Map<string, string>();
	for (const chunk of chunkValues(keys, 1_000)) {
		const found = await database
			.select({ nameKey: institutionCountry.nameKey, countryCode: institutionCountry.countryCode })
			.from(institutionCountry)
			.where(inArray(institutionCountry.nameKey, chunk));
		for (const row of found) known.set(row.nameKey, row.countryCode);
	}
	const countries = new Map<string, Set<string>>();
	for (const row of rows) {
		const code = known.get(institutionNameKey(row.institutionName));
		if (code) countries.set(row.itemKey, (countries.get(row.itemKey) ?? new Set()).add(code));
	}
	return (itemKey: string) => [...(countries.get(itemKey) ?? [])].sort();
}

export function cleanRow(row: ItemRow) {
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

export function metadataSearchValues(row: ItemRow) {
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
	config: LibraryServerConfig,
	topLevelKeys: readonly string[],
	collections: readonly CollectionRow[],
	catalogDatabase?: Database,
): Promise<SearchProjectionPlan> {
	const hiddenTags = config.content.tags.hidden;
	const publication = config.services.publication;
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
	const readings = new Map(
		(await database
			.select({
				key: itemReading.itemKey, screenedOut: itemReading.screenedOut, studyType: itemReading.studyType,
				typeConfidence: itemReading.typeConfidence, typedBy: itemReading.typedBy, input: itemReading.input, contentHash: itemReading.contentHash,
			})
			.from(itemReading)
			.where(inArray(itemReading.itemKey, topLevelKeys)))
			.map((row) => [row.key, row]),
	);
	// A record its sources screen out leaves the index, and comes back if a grade or source lets it in again.
	const activeParents = itemRows.filter(
		(row) => isPublicTopLevelItem(row.item) && row.item.deleted !== 1 && !readings.get(row.item.key)?.screenedOut,
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
	const [tagRows, membershipRows, institutionRows, identifiersByItem] =
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
					readPublicIdentifiers(
						database,
						activeParents.map(({ item }) => item),
						publication,
					),
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
	const authorCountriesOf = await authorCountriesByItem(
		database,
		institutionRows.filter((row) => row.source === "author"),
	);
	const [linksByItem, citationMetricsByItem, openAccessOf, { sourcesOf, workOf }] = await Promise.all([
		getPublicItemLinksForKeys(database, activeParentKeys, { hiddenTags }),
		getSourceCitationMetricsForKeys(database, activeParentKeys),
		readOpenAccess(database, activeParentKeys),
		readItemSources(database, activeParentKeys),
	]);
	const childrenByParent = new Map<string, ItemRow[]>();
	for (const child of children) {
		if (!child.parentItem) continue;
		const siblings = childrenByParent.get(child.parentItem) ?? [];
		siblings.push(child);
		childrenByParent.set(child.parentItem, siblings);
	}
	const collectionsByKey = new Map(collections.map((row) => [row.key, row]));
	const directTopicIds = uniqueSorted(
		activeParents.flatMap(({ item: parent }) => parent.topics),
	);
	const topicNodes =
		config.topics.enabled && catalogDatabase && directTopicIds.length > 0
			? await resolveTopicAncestry(directTopicIds, {
					database: catalogDatabase,
					config,
				})
			: [];
	const topicsById = new Map(topicNodes.map((node) => [node.id, node]));
	const topicAncestry = (topicIds: readonly string[]) => {
		const ids = new Set<string>();
		for (const topicId of topicIds) {
			let current = topicsById.get(topicId);
			while (current && !ids.has(current.id)) {
				ids.add(current.id);
				current = current.parent
					? topicsById.get(current.parent)
					: undefined;
			}
		}
		return uniqueSorted(ids);
	};

	const documents = activeParents.map(
		({ item: parent, provider, sourceExternalScopeKey }) => {
			const directCollections = uniqueSorted(
				collectionsByItem.get(parent.key) ?? [],
			);
			const parentChildren = childrenByParent.get(parent.key) ?? [];
			const citationMetrics = citationMetricsByItem.get(parent.key) ?? [];
			const links = linksByItem.get(parent.key) ?? {
				cites: [],
				citedBy: [],
				related: [],
			};
			const attachments = parentChildren.map((child) => ({
				...cleanRow({
					...child,
					fullTextPDF: null,
				}),
				tags: uniqueSorted(tagsByItem.get(child.key) ?? []),
			}));
			// Without full-text search nothing can reach the page text, so only
			// page numbers are indexed: they still mark records with a PDF.
			const fullTextPDFs = parentChildren
				.filter((child) => child.deleted !== 1)
				.map((child) => ({
					key: child.key,
					fullTextPDF: config.search.fullText
						? fullTextPages(child.fullTextPDF)
						: fullTextPages(child.fullTextPDF).map(({ page }) => ({ page })),
				}))
				.filter((entry) => entry.fullTextPDF.length > 0);
			const publicationIdentifiers = identifiersByItem.get(parent.key);
			const doi = resolvePublicDoi({
				...parent,
				publicationIdentifiers,
				attachments: parentChildren
					.filter(
						(child) =>
							child.deleted !== 1 &&
							!hasAnyTag(
								tagsByItem.get(child.key),
								hiddenTags,
							),
					)
					.map((child) => ({
						url: child.url,
						tags: tagsByItem.get(child.key),
					})),
			});

			return {
				...cleanRow(parent),
				DOI: doi,
				// A stored PDF or a linked one: the AI can read either, even
				// when no text was extracted. The library's hidden tags always
				// apply, because the search filter cannot see attachment tags.
				[PDF_PRESENCE_ATTRIBUTE]: parentChildren.some(
					(child) =>
						child.deleted !== 1 &&
						!hasAnyTag(tagsByItem.get(child.key), hiddenTags) &&
						isVisiblePdfAttachment(child),
				),
				...bibliographicDateSearchFields(parent.date),
				attachmentsData: attachments,
				citationMetrics,
				// What the citation sorts order by: the higher of the library's
				// own count and a source's (OpenAlex counts citations worldwide).
				citationCount: Math.max(
					links.citedBy.length,
					...citationMetrics.map((metric) => metric.citedByCount ?? 0),
				),
				collections: directCollections,
				collectionsAncestry: collectionAncestry(
					directCollections,
					collectionsByKey,
				),
				country: resolveCountryFocus(parent),
				authorCountry: authorCountriesOf(parent.key),
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
				links,
				metadataSearch: metadataSearchValues(parent),
				openAccess: openAccessOf(parent.key, doi),
				openalexId: workOf(parent.key),
				topicAncestors: topicAncestry(parent.topics),
				topics: config.topics.enabled ? uniqueSorted(parent.topics) : [],
				key: parent.key,
				provider,
				...(publicationIdentifiers ? { publicationIdentifiers } : {}),
				revision: parent.revision,
				// What kind of work it is, once read: filtered and counted by `studyType`, shown from `reading`.
				...readingFields(readings.get(parent.key), parent),
				sourceConnectionKey: parent.sourceConnectionKey,
				sourceExternalScopeKey,
				sourceRecordKey: parent.sourceRecordKey,
				[SOURCES_FIELD]: sourcesOf(parent.key),
				tags: uniqueSorted(tagsByItem.get(parent.key) ?? []),
			} satisfies ItemSearchDocument;
		},
	);
	const documentKeys = new Set(documents.map((document) => document.key));
	const deleteKeys = topLevelKeys.filter((key) => !documentKeys.has(key));
	const recordKeys = new Set(itemRows.filter((row) => row.item.parentItem === null).map((row) => row.item.key));
	return {
		deleteKeys,
		documents,
		removedRecordKeys: deleteKeys.filter((key) => recordKeys.has(key)),
	};
}

async function* plansForKeys(
	database: Database,
	config: LibraryServerConfig,
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
					config,
					keyChunk,
					collections,
					database,
				),
		);
	}
}

export async function* generateSearchProjectionPlans(
	database: Database,
	config: LibraryServerConfig,
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
	yield* plansForKeys(
		database,
		config,
		topLevelKeys,
		collections,
		batchSize,
		signal,
	);
}

export async function* generateFullSearchProjectionPlans(
	database: Database,
	config: LibraryServerConfig,
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
		config,
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
	return database.transaction(
		(transaction) => projectPublicItems(transaction, keys, config),
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
}

/** The public projection of these records as the given transaction sees them, which may include uncommitted changes. */
export async function projectPublicItems(
	transaction: DatabaseTransaction,
	keys: readonly string[],
	config: LibraryServerConfig,
): Promise<Item[]> {
	const { rows: collections } =
		await transaction.execute<CollectionRow>(sql`
	WITH RECURSIVE ancestors AS (
		SELECT current.key, current."parentCollection", current.deleted
		FROM ${collection} current
		JOIN ${itemToCollection} membership ON membership."collectionKey" = current.key
		WHERE membership."itemKey" IN (${sql.join(
			keys.map((key) => sql`${key}`),
			sql`, `,
		)})
		UNION
		SELECT parent.key, parent."parentCollection", parent.deleted
		FROM ${collection} parent
		JOIN ancestors child ON parent.key = child."parentCollection"
	)
	SELECT * FROM ancestors
`);
	const plan = await buildSearchProjectionPlanForKeys(
		transaction,
		config,
		keys,
		collections,
	);
	const documents = new Map(
		plan.documents.map((document) => [document.key, document]),
	);
	return keys.flatMap((key) => {
		const document = documents.get(key);
		const result = document ? publicItemFrom(document, config) : null;
		return result ? [result] : [];
	});
}

/** A search document as readers get it: null when it is hidden, and without attachments they can't see. */
export function publicItemFrom(document: Pick<ItemSearchDocument, "tags">, config: LibraryServerConfig): Item | null {
	if (hasAnyTag(document.tags, config.content.tags.hidden)) return null;
	const result = document as unknown as Item;
	result.attachmentsData = filterPublicAttachments(
		result.attachmentsData,
		publicTagRules(config),
		result.sourceConnectionKey,
	);
	const attachmentKeys = new Set(
		result.attachmentsData?.map((attachment) => attachment.key),
	);
	result.fullTextPDFs = result.fullTextPDFs?.filter(
		(attachment) => attachmentKeys.has(attachment.key),
	);
	return result;
}
