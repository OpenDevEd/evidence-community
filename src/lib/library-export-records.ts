import { publicParentVisibility } from "@/lib/public-item-visibility";
import { readPublicDoiAttachments, readPublicIdentifiers } from "@/lib/publication/public-identifiers";
import { resolvePublicDoi } from "@/lib/publication/publication-identifier-summary";
import {
	and,
	asc,
	count,
	max,
	desc,
	gt,
	inArray,
	sql,
} from "drizzle-orm";

import { getDatabaseForConfig, type Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Item } from "@/app/api/item/types";

/**
 * The only record columns an export may read. This is an allow-list on
 * purpose: stored full text (`fullTextPDF`), cover images
 * (`PDFCoverPageImage`, `PDFCoverPageWidth`, `PDFCoverPageHeight`), note and
 * annotation bodies, and file details are never loaded, however the search
 * index or the database happens to be configured.
 */
export const CITATION_RECORD_COLUMNS = [
	"key",
	"itemType",
	"title",
	"shortTitle",
	"abstractNote",
	"authority",
	"creators",
	"medium",
	"artworkSize",
	"date",
	"originalDate",
	"archive",
	"archiveLocation",
	"libraryCatalog",
	"callNumber",
	"url",
	"accessDate",
	"rights",
	"extra",
	"seriesTitle",
	"numberOfVolumes",
	"volume",
	"place",
	"eventPlace",
	"originalPlace",
	"runningTime",
	"ISBN",
	"code",
	"section",
	"session",
	"history",
	"series",
	"seriesNumber",
	"edition",
	"publisher",
	"originalPublisher",
	"numPages",
	"pages",
	"reporter",
	"versionNumber",
	"system",
	"programmingLanguage",
	"conferenceName",
	"DOI",
	"PMCID",
	"PMID",
	"committee",
	"publicationTitle",
	"issue",
	"seriesText",
	"journalAbbreviation",
	"ISSN",
	"scale",
	"country",
	"assignee",
	"filingDate",
	"applicationNumber",
	"priorityNumbers",
	"references",
	"meetingName",
	"codeNumber",
	"type",
	"citationKey",
	"number",
	"status",
	"partNumber",
	"partTitle",
	"citation",
	"languageName",
	"dateAdded",
	"dateModified",
	"updatedAt",
] as const satisfies readonly (keyof typeof item.$inferSelect)[];

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

async function attachTags(
	database: Database,
	records: Record<string, unknown>[],
) {
	if (records.length === 0) return records as Item[];

	const rows = await database
		.select({ itemKey: itemToTag.itemKey, tagName: itemToTag.tagName })
		.from(itemToTag)
		.where(
			inArray(
				itemToTag.itemKey,
				records.map((record) => String(record.key)),
			),
		);

	const tagsByKey = new Map<string, string[]>();
	for (const row of rows) {
		const tags = tagsByKey.get(row.itemKey);
		if (tags) tags.push(row.tagName);
		else tagsByKey.set(row.itemKey, [row.tagName]);
	}

	for (const record of records) {
		record.tags = tagsByKey.get(String(record.key)) ?? [];
	}

	return records as Item[];
}

/**
 * The query behind one page of a whole-library citation file.
 *
 * Paging walks the primary key upwards rather than counting from an offset.
 * A record added or removed while the file is being written can therefore
 * never make an untouched record appear twice or be skipped.
 */
export function buildCitationRecordsQuery(
	database: Database,
	config: LibraryServerConfig,
	afterKey: string | null,
	limit: number,
) {
	return database
		.select(selectionFor(CITATION_RECORD_COLUMNS))
		.from(item)
		.where(
			and(
				publicRecordCondition(database, config),
				afterKey ? gt(item.key, afterKey) : undefined,
			),
		)
		.orderBy(asc(item.key))
		.limit(limit);
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

export async function readCitationRecordsPage(
	config: LibraryServerConfig,
	afterKey: string | null,
	limit: number,
): Promise<Item[]> {
	const database = await getDatabaseForConfig(config);
	const records = await buildCitationRecordsQuery(
		database,
		config,
		afterKey,
		limit,
	);

	const [tagged, identifiers, doiAttachments] = await Promise.all([
		attachTags(database, records as Record<string, unknown>[]),
		readPublicIdentifiers(
			database,
			records.map((record) => ({ ...record, key: String(record.key) })),
			config.services.publication,
		),
		readPublicDoiAttachments(database, records.map(record => String(record.key)), config.content.tags.hidden),
	]);
	return tagged.map((record) => ({
		...record,
		publicationIdentifiers: identifiers.get(record.key),
		DOI: resolvePublicDoi({
			...record, attachments: doiAttachments.get(record.key),
			publicationIdentifiers: identifiers.get(record.key),
		}),
	}));
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
