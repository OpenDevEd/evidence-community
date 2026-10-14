import { parseBibliographicDate } from "@/lib/bibliographic-date";
import { normalizeDoi } from "@/lib/doi";
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

const codesByName = new Map<number, Map<string, string>>();
/** Language codes of one length by their English names: "swahili" to "sw", "cebuano" to "ceb". */
function languageCodes(length: 2 | 3) {
	const known = codesByName.get(length);
	if (known) return known;
	const names = new Intl.DisplayNames(["en"], { fallback: "none", type: "language" });
	const letters = [..."abcdefghijklmnopqrstuvwxyz"];
	const codes = length === 2 ? letters.flatMap((first) => letters.map((second) => first + second)) : letters.flatMap((first) => letters.flatMap((second) => letters.map((third) => first + second + third)));
	const found = new Map(codes.flatMap((code) => {
		const name = names.of(code);
		// A retired code names the same language as its successor: "iw" is "he".
		return name ? [[name.toLowerCase(), Intl.getCanonicalLocales(code)[0]!] as const] : [];
	}));
	codesByName.set(length, found);
	return found;
}

/**
 * A record's language as XMP writes it: the tag it holds ("en-GB"), or the
 * code of the language it names ("English"); otherwise none. Tags prefer
 * two-letter codes, and the three-letter list takes a moment to build, so
 * it is read only for a name the two-letter one doesn't have.
 */
export const languageTag = (value: string) => (!value || /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value) ? value : (languageCodes(2).get(value.toLowerCase()) ?? languageCodes(3).get(value.toLowerCase()) ?? ""));

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
