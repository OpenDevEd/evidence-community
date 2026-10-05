import { create } from "xmlbuilder2";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import {
	getLibraryExportPath,
	LIBRARY_EXPORT_RECORD_CAP,
	type BibliographicExportFormat,
} from "@/config/library-config/exports";
import type { Item } from "@/app/api/item/types";
import { convertItem } from "@/lib/actions";
import { readNewestRecords } from "@/lib/library-export-records";
import { exportTooLarge } from "./library-export-request";
import { buildSiteUrl } from "@/lib/site-url";
import { itemToCitationData } from "@/lib/citation-data";
import type { CitationData } from "@/lib/citation-formats";

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
 * Turns one page of records into citation text. A failed conversion aborts
 * the download so it cannot silently omit a publication.
 */
export async function convertRecordsToCitations(
	records: readonly Item[],
	format: BibliographicExportFormat,
) {
	const converted = await Promise.all(
		records.map((record) => convertItem(record, format)),
	);

	const failedIndex = converted.findIndex((entry) => !entry.trim());
	if (failedIndex !== -1)
		throw new Error(
			`Unable to export publication ${records[failedIndex].key}`,
		);
	return converted;
}

/**
 * Read a bounded selection page by page. An extra row fails the download.
 */
async function* citationRecordPages(readPage: CitationRecordReader) {
	let afterKey: string | null = null;
	let read = 0;
	while (read <= LIBRARY_EXPORT_RECORD_CAP) {
		const records = await readPage(
			afterKey,
			Math.min(
				LIBRARY_EXPORT_PAGE_SIZE,
				LIBRARY_EXPORT_RECORD_CAP + 1 - read,
			),
		);
		if (!records.length) return;
		read += records.length;
		if (read > LIBRARY_EXPORT_RECORD_CAP) throw exportTooLarge();
		afterKey = String(records[records.length - 1].key);
		yield records;
	}
}

export function streamCitationRecords(
	readPage: CitationRecordReader,
	format: BibliographicExportFormat,
) {
	const encoder = new TextEncoder();
	const pages = citationRecordPages(readPage);
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const page = await pages.next();
			if (page.done) {
				controller.close();
				return;
			}
			const entries = await convertRecordsToCitations(page.value, format);
			if (entries.length)
				controller.enqueue(
					encoder.encode(`${entries.join("\n\n")}\n\n`),
				);
		},
		async cancel() {
			await pages.return();
		},
	});
}

/** CSL needs the complete set to sort, disambiguate names and assign reference numbers. */
export async function readLibraryCitationData(
	readPage: CitationRecordReader,
): Promise<CitationData[]> {
	const data: CitationData[] = [];
	for await (const records of citationRecordPages(readPage)) {
		for (const record of records) {
			const citation = itemToCitationData(record);
			if (!citation)
				throw new Error(`Unable to export publication ${record.key}`);
			data.push(citation);
		}
	}
	return data;
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
