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
import { item } from "@/db/schema/tables/item";
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
function publicRecordCondition(
	database: Database,
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
