import { parseBibliographicDate } from "@/lib/bibliographic-date";
import { normalizeDoi } from "@/lib/doi";
import { languageTag } from "@/lib/languages";
import { publicTags } from "@/lib/publication/record-metadata";

/** What a PDF says about itself in its document properties and XMP block. Empty when unset. */
export type PdfProperties = {
	authors: string[];
	/** Publication date: a year, a month or a day, as XMP dates are written. */
	date: string;
	doi: string;
	isbn: string;
	issn: string;
	issue: string;
	keywords: string[];
	/** A language tag such as "en". */
	language: string;
	pages: string;
	/** The journal, book, proceedings or website it appeared in. */
	publicationTitle: string;
	publisher: string;
	rights: string;
	seriesNumber: string;
	seriesTitle: string;
	subject: string;
	title: string;
	volume: string;
};

const textOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// XMP dates and language tags have set forms; a record's value is only written when it has them.
export const xmpDate = (value: string) => (parseBibliographicDate(value).kind === "parsed" ? value : "");

/**
 * What a published PDF carries in its own metadata: the record as the
 * library has it, its authors, and keywords (topic names and the tags a
 * reader may see) and DOI
 * as the caller knows them. The review's preview and publishing both use it,
 * so this module stays free of the PDF and XML libraries the writer needs.
 */
export function pdfPropertiesOfRecord(payload: Record<string, unknown>, { authors, doi, keywords }: { authors: string[]; doi: string; keywords: string[] }): PdfProperties {
	const tags = publicTags(Array.isArray(payload.tags) ? payload.tags.map(textOf) : []);
	return {
		authors,
		date: xmpDate(textOf(payload.date)),
		// A DOI stored as an address or with "doi:" is written as the DOI itself.
		doi: normalizeDoi(textOf(payload.DOI)) ?? normalizeDoi(doi) ?? "",
		isbn: textOf(payload.ISBN),
		issn: textOf(payload.ISSN),
		issue: textOf(payload.issue),
		keywords: [...new Set([...keywords, ...tags])],
		language: languageTag(textOf(payload.languageName)),
		pages: textOf(payload.pages),
		publicationTitle: textOf(payload.publicationTitle),
		publisher: textOf(payload.publisher),
		rights: textOf(payload.rights),
		seriesNumber: textOf(payload.seriesNumber),
		seriesTitle: textOf(payload.seriesTitle) || textOf(payload.series),
		subject: textOf(payload.abstractNote),
		title: textOf(payload.title),
		volume: textOf(payload.volume),
	};
}
