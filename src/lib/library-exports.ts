import { create } from "xmlbuilder2";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import {
	getLibraryExportPath,
	type BibliographicExportFormat,
} from "@/config/library-config/exports";
import type { Item } from "@/app/api/item/types";
import { convertItem } from "@/lib/actions";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { getMainAttributes, getPublicRecordFilters } from "@/lib/search";
import { buildSiteUrl } from "@/lib/site-url";

// How many records one whole-library citation file may contain. A library with
// more records stops at this many; the rest stay reachable one record at a
// time. The cap keeps a single request inside a sensible memory and time
// budget.
export const LIBRARY_EXPORT_RECORD_CAP = 20_000;

// How many records are read from the search index per round trip while the
// file is being written.
export const LIBRARY_EXPORT_PAGE_SIZE = 250;

// How many records the Atom feed lists.
const ATOM_FEED_RECORD_COUNT = 50;

// Stored full text and cover images are large and are never part of a
// citation, so they are left out of every export read.
const HEAVY_RECORD_FIELDS = new Set([
	"attachmentsData",
	"fullTextPDF",
	"fullTextPDFs",
	"PDFCoverPageImage",
	"PDFCoverPageWidth",
	"PDFCoverPageHeight",
]);

const ATOM_RECORD_FIELDS = [
	"key",
	"title",
	"abstractNote",
	"creators",
	"fullNames",
	"date",
	"dateAdded",
	"dateModified",
	"updatedAt",
] as const;

async function getCitationRecordFields(config: LibraryServerConfig) {
	const attributes = await getMainAttributes(config);
	return attributes.filter(
		(attribute) => !HEAVY_RECORD_FIELDS.has(attribute),
	);
}

export function buildLibraryExportFilename(
	shortName: string,
	extension: string,
) {
	const basename =
		shortName
			.normalize("NFKD")
			.replace(/\p{Mark}+/gu, "")
			.replace(/[^\p{Letter}\p{Number}]+/gu, "-")
			.replace(/^-+|-+$/gu, "")
			.toLowerCase() || "evidence-library";

	return `${basename}.${extension}`;
}

/**
 * Reads one page of the records a visitor is allowed to see, straight from the
 * library's own data. `sort` is only accepted for sortable index attributes.
 */
async function readPublicRecords(
	config: LibraryServerConfig,
	options: {
		offset: number;
		limit: number;
		fields: readonly string[];
		sort?: readonly string[];
	},
): Promise<Item[]> {
	const { index } = await getMeilisearchForConfig(config);
	const result = await index.getDocuments({
		offset: options.offset,
		limit: options.limit,
		fields: [...options.fields],
		filter: getPublicRecordFilters(config),
		...(options.sort ? { sort: [...options.sort] } : {}),
	});

	return result.results as Item[];
}

/**
 * Turns one page of records into citation text. Records the converter cannot
 * read are skipped instead of breaking the whole file.
 */
export async function convertRecordsToCitations(
	records: readonly Item[],
	format: BibliographicExportFormat,
) {
	const converted = await Promise.all(
		records.map((record) => convertItem(record, format)),
	);

	return converted.filter((entry) => entry.trim().length > 0);
}

/**
 * Writes the whole library as one RIS or BibTeX file. Records are read and
 * converted a page at a time, so the response starts before the last record
 * has been read and memory stays flat.
 */
export async function streamLibraryCitations(
	config: LibraryServerConfig,
	format: BibliographicExportFormat,
) {
	const encoder = new TextEncoder();
	// Resolved before the stream starts: the index settings are read through a
	// request-scoped cache that is gone once the response is being sent.
	const fields = await getCitationRecordFields(config);
	let offset = 0;

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (offset >= LIBRARY_EXPORT_RECORD_CAP) {
				controller.close();
				return;
			}

			const records = await readPublicRecords(config, {
				offset,
				limit: Math.min(
					LIBRARY_EXPORT_PAGE_SIZE,
					LIBRARY_EXPORT_RECORD_CAP - offset,
				),
				fields,
			});

			if (records.length === 0) {
				controller.close();
				return;
			}

			offset += records.length;

			const entries = await convertRecordsToCitations(records, format);
			if (entries.length > 0) {
				controller.enqueue(
					encoder.encode(`${entries.join("\n\n")}\n\n`),
				);
			}
		},
	});
}

function toRfc3339(value: unknown, fallback: Date) {
	const date = typeof value === "string" || value instanceof Date
		? new Date(value)
		: null;

	return (date && !Number.isNaN(date.getTime()) ? date : fallback)
		.toISOString();
}

function toPlainSummary(record: Item) {
	const abstract = typeof record.abstractNote === "string"
		? record.abstractNote
		: "";
	const summary = abstract.replace(/\s+/gu, " ").trim();

	return summary.length > 1000 ? `${summary.slice(0, 999)}…` : summary;
}

/**
 * Builds an Atom 1.0 feed of the newest records. Everything comes from the
 * library's own records; nothing is fetched from elsewhere.
 */
export function buildAtomFeed(
	config: LibraryServerConfig,
	records: readonly Item[],
	now: Date = new Date(),
) {
	const baseUrl = config.identity.baseUrl;
	const feedUrl = buildSiteUrl(getLibraryExportPath("atom"), baseUrl);
	const libraryUrl = buildSiteUrl("/lib", baseUrl);
	const entryDates = records.map((record) =>
		toRfc3339(record.updatedAt ?? record.dateModified, now),
	);

	const feed = create({ version: "1.0", encoding: "UTF-8" })
		.ele("feed", { xmlns: "http://www.w3.org/2005/Atom" });

	feed.ele("id").txt(libraryUrl).up();
	feed.ele("title").txt(config.identity.name).up();
	feed
		.ele("updated")
		.txt(entryDates.length > 0 ? entryDates.slice().sort().at(-1)! : toRfc3339(null, now))
		.up();
	feed.ele("link", { rel: "self", href: feedUrl }).up();
	feed.ele("link", { rel: "alternate", href: libraryUrl }).up();
	feed.ele("author").ele("name").txt(config.identity.name).up().up();

	records.forEach((record, index) => {
		const recordUrl = buildSiteUrl(`/lib/${record.key}`, baseUrl);
		const entry = feed.ele("entry");

		entry.ele("id").txt(recordUrl).up();
		entry
			.ele("title")
			.txt(
				typeof record.title === "string" && record.title.trim()
					? record.title
					: record.key,
			)
			.up();
		entry.ele("link", { rel: "alternate", href: recordUrl }).up();
		entry.ele("updated").txt(entryDates[index]).up();

		const summary = toPlainSummary(record);
		if (summary) {
			entry.ele("summary", { type: "text" }).txt(summary).up();
		}

		entry.up();
	});

	return feed.end({ prettyPrint: true });
}

/**
 * Reads the newest records for the Atom feed.
 */
export function readAtomFeedRecords(config: LibraryServerConfig) {
	return readPublicRecords(config, {
		offset: 0,
		limit: ATOM_FEED_RECORD_COUNT,
		fields: ATOM_RECORD_FIELDS,
		sort: ["dateAdded:desc"],
	});
}
