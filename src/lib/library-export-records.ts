import { CITATION_RECORD_COLUMNS } from "@/lib/citation-record-columns";
import { publicParentVisibility } from "@/lib/public-item-visibility";
import { readPublicDoiAttachments, readPublicIdentifiers } from "@/lib/publication/public-identifiers";
import { resolvePublicDoi } from "@/lib/publication/publication-identifier-summary";
import {
	and,
	asc,
	count,
	max,
	desc,
	inArray,
	sql,
} from "drizzle-orm";

import { getDatabaseForConfig, type Database } from "@/db";
import { abstractHasText, item } from "@/db/schema/tables/item";
import { readItemTags } from "@/lib/item-tags";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Item } from "@/app/api/item/types";

/** The extra columns the Atom feed needs on top of nothing else. */
const FEED_RECORD_COLUMNS = [
	"key",
	"title",
	"abstractNote",
	"creators",
	"date",
	"dateAdded",
	"dateModified",
	"updatedAt",
] as const satisfies readonly (typeof CITATION_RECORD_COLUMNS)[number][];

function selectionFor(columns: readonly string[]) {
	return Object.fromEntries(
		columns.map((column) => [
			column,
			item[column as keyof typeof item] as never,
		]),
	);
}

/**
 * Records a visitor is allowed to see: live, not a note, attachment or
 * annotation, and not carrying one of the library's hidden tags. Tag matching
 * ignores letter case, the same as `hasAnyTag` in the rest of the runtime.
 */
export function publicRecordCondition(
	database: Pick<Database, "select">,
	config: LibraryServerConfig,
) {
	return publicParentVisibility(database, config.content.tags.hidden);
}

/** Capture the whole-library selection in one database snapshot, in key order, from `offset` on. */
export function buildPublicLibraryKeysQuery(
	database: Database,
	config: LibraryServerConfig,
	limit: number,
	offset = 0,
) {
	return database
		.select({ key: item.key })
		.from(item)
		.where(publicRecordCondition(database, config))
		.orderBy(asc(item.key))
		.limit(limit)
		.offset(offset);
}

/**
 * Records worth a search result: public ones with an abstract. A record without one is only a title and a few names,
 * the thin page search engines skip, so the sitemap leaves it out; its page stays open to visitors and crawlers.
 * `item_sitemap_key_idx` holds exactly these records in key order.
 */
function sitemapRecordCondition(database: Pick<Database, "select">, config: LibraryServerConfig) {
	return and(publicRecordCondition(database, config), abstractHasText(item.abstractNote));
}

/** One sitemap's records, in key order, from `offset` on. Read it through `readSitemapKeys`. */
export function buildSitemapKeysQuery(database: Pick<Database, "select">, config: LibraryServerConfig, limit: number, offset: number) {
	return database.select({ key: item.key }).from(item).where(sitemapRecordCondition(database, config))
		.orderBy(asc(item.key)).limit(limit).offset(offset);
}

/**
 * Runs a sitemap read so that it walks `item_sitemap_key_idx` in key order. PostgreSQL estimates a partial index's
 * condition at about 1% of rows when nearly all of them match, so it picks a bitmap scan instead, which runs the abstract's
 * regular expression again on every row (12.7 s on AIED's 270,000 records, against 1.2 s walking the index). Parallel
 * workers are off as well: under a crawler's burst they ran out of the shared server's 64 MB of shared memory.
 */
async function readWithSitemapIndex<T>(database: Database, read: (transaction: Pick<Database, "select">) => Promise<T>) {
	return database.transaction(async (transaction) => {
		await transaction.execute(sql`SET LOCAL enable_bitmapscan = off`);
		await transaction.execute(sql`SET LOCAL max_parallel_workers_per_gather = 0`);
		return read(transaction);
	});
}

/** One sitemap's record keys, in key order, from `offset` on. */
export async function readSitemapKeys(database: Database, config: LibraryServerConfig, limit: number, offset: number) {
	const rows = await readWithSitemapIndex(database, (transaction) => buildSitemapKeysQuery(transaction, config, limit, offset));
	return rows.map((row) => row.key);
}

/** How many records the sitemaps list. */
export async function countSitemapRecords(database: Database, config: LibraryServerConfig) {
	const [row] = await readWithSitemapIndex(database, (transaction) =>
		transaction.select({ total: count() }).from(item).where(sitemapRecordCondition(transaction, config)));
	return row?.total ?? 0;
}

/** The query behind the Atom feed: newest addition first. */
export function buildNewestRecordsQuery(
	database: Database,
	config: LibraryServerConfig,
	limit: number,
) {
	return database
		.select(selectionFor(FEED_RECORD_COLUMNS))
		.from(item)
		.where(publicRecordCondition(database, config))
		.orderBy(sql`${item.dateAdded} DESC NULLS LAST`, desc(item.key))
		.limit(limit);
}

/** Capture only keys, in one database snapshot; the caller rejects the extra row. */
export async function readPublicLibraryKeys(config: LibraryServerConfig, limit: number) {
	const database = await getDatabaseForConfig(config);
	return (await buildPublicLibraryKeysQuery(database, config, limit)).map(row => row.key);
}

/** The held order comes from the selection; bibliographic fields and visibility come from PostgreSQL. */
export async function readCitationRecordsByKeys(config: LibraryServerConfig, keys: string[]): Promise<Item[]> {
	if (!keys.length) return [];
	const database = await getDatabaseForConfig(config);
	const records = await database.select(selectionFor(CITATION_RECORD_COLUMNS)).from(item)
		.where(and(publicRecordCondition(database, config), inArray(item.key, keys)));
	const hydrated = await hydrateCitationRecords(database, config, records);
	const byKey = new Map(hydrated.map(record => [record.key, record]));
	return keys.flatMap(key => byKey.has(key) ? [byKey.get(key)!] : []);
}

async function hydrateCitationRecords(
	database: Database,
	config: LibraryServerConfig,
	records: Record<string, unknown>[],
): Promise<Item[]> {

	const [tags, identifiers, doiAttachments] = await Promise.all([
		readItemTags(database, records.map(record => String(record.key))),
		readPublicIdentifiers(
			database,
			records.map((record) => ({ ...record, key: String(record.key) })),
			config.services.publication,
		),
		readPublicDoiAttachments(database, records.map(record => String(record.key)), config.content.tags.hidden),
	]);
	return records.map((record) => ({
		...record,
		tags: tags.get(String(record.key)) ?? [],
		publicationIdentifiers: identifiers.get(String(record.key)),
		DOI: resolvePublicDoi({
			...record, attachments: doiAttachments.get(String(record.key)),
			publicationIdentifiers: identifiers.get(String(record.key)),
		}),
	})) as Item[];
}

export async function readNewestRecords(
	config: LibraryServerConfig,
	limit: number,
): Promise<Item[]> {
	const database = await getDatabaseForConfig(config);
	const records = await buildNewestRecordsQuery(database, config, limit);

	return records as unknown as Item[];
}

/** Count the same public records used by library exports, without search filters. */
export async function readPublicLibraryStatus(database: Database, config: LibraryServerConfig) {
	const [status] = await database.select({
		totalItems: count(),
		latestPublicationUpdatedAt: max(item.updatedAt),
	}).from(item).where(publicRecordCondition(database, config));
	return status;
}

export type PublicLibraryStatus = Awaited<ReturnType<typeof readPublicLibraryStatus>>;
