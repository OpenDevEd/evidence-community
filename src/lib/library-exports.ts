import { create } from "xmlbuilder2";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import {
	getLibraryExportPath,
	LIBRARY_EXPORT_RECORD_CAP,
	type BibliographicExportFormat,
} from "@/config/library-config/exports";
import type { Item } from "@/app/api/item/types";
import { convertItem } from "@/lib/actions";
import {
	readCitationRecordsPage,
	readNewestRecords,
} from "@/lib/library-export-records";
import { buildSiteUrl } from "@/lib/site-url";

// How many records are read from the database per round trip while the file
// is being written.
export const LIBRARY_EXPORT_PAGE_SIZE = 250;

// How many records the Atom feed lists.
const ATOM_FEED_RECORD_COUNT = 50;

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
 * Reads one page of records that start after `afterKey`. Injecting the reader
 * keeps the paging rules testable without a database.
 */
export type CitationRecordReader = (
	afterKey: string | null,
	limit: number,
) => Promise<Item[]>;

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
 * Writes the whole library as one RIS or BibTeX file.
 *
 * Records are read a page at a time, walking the record key upwards, so the
 * response starts before the last record has been read, memory stays flat, and
 * a record added or removed during the write cannot duplicate or skip another
 * record. Writing stops after `LIBRARY_EXPORT_RECORD_CAP` records.
 */
export function streamCitationRecords(
	readPage: CitationRecordReader,
	format: BibliographicExportFormat,
) {
	const encoder = new TextEncoder();
	let afterKey: string | null = null;
	let written = 0;

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const remaining = LIBRARY_EXPORT_RECORD_CAP - written;
			if (remaining <= 0) {
				controller.close();
				return;
			}

			const records = await readPage(
				afterKey,
				Math.min(LIBRARY_EXPORT_PAGE_SIZE, remaining),
			);

			if (records.length === 0) {
				controller.close();
				return;
			}

			written += records.length;
			afterKey = String(records[records.length - 1].key);

			const entries = await convertRecordsToCitations(records, format);
			if (entries.length > 0) {
				controller.enqueue(
					encoder.encode(`${entries.join("\n\n")}\n\n`),
				);
			}
		},
	});
}

export function streamLibraryCitations(
	config: LibraryServerConfig,
	format: BibliographicExportFormat,
) {
	return streamCitationRecords(
		(afterKey, limit) => readCitationRecordsPage(config, afterKey, limit),
		format,
	);
}

function toRfc3339(value: unknown, fallback: Date) {
	const date =
		typeof value === "string" || value instanceof Date
			? new Date(value)
			: null;

	return (
		date && !Number.isNaN(date.getTime()) ? date : fallback
	).toISOString();
}

function toPlainSummary(record: Item) {
	const abstract =
		typeof record.abstractNote === "string" ? record.abstractNote : "";
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
	const feedUpdated =
		entryDates.length > 0
			? entryDates.slice().sort().at(-1)!
			: toRfc3339(null, now);

	const feed = create({ version: "1.0", encoding: "UTF-8" }).ele("feed", {
		xmlns: "http://www.w3.org/2005/Atom",
	});

	feed.ele("id").txt(libraryUrl).up();
	feed.ele("title").txt(config.identity.name).up();
	feed.ele("updated").txt(feedUpdated).up();
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
	return readNewestRecords(config, ATOM_FEED_RECORD_COUNT);
}
