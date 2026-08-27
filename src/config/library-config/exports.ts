import type { LibraryPublicConfig } from "./schema";

const BIBLIOGRAPHIC_EXPORT_FORMATS = [
	"ris",
	"bibtex",
] as const;
const LIBRARY_EXPORT_FORMATS = [
	...BIBLIOGRAPHIC_EXPORT_FORMATS,
	"atom",
] as const;

export type BibliographicExportFormat =
	(typeof BIBLIOGRAPHIC_EXPORT_FORMATS)[number];
export type LibraryExportFormat =
	(typeof LIBRARY_EXPORT_FORMATS)[number];

// How many records one whole-library citation file may contain. A library
// with more records stops at this many; the rest stay reachable one record at
// a time. The cap keeps a single request inside a sensible memory and time
// budget, and the download button never promises more than this.
export const LIBRARY_EXPORT_RECORD_CAP = 20_000;

const EXPORT_PATHS = {
	ris: "/lib/export/ris",
	bibtex: "/lib/export/bibtex",
	atom: "/lib/atom.xml",
} as const satisfies Record<LibraryExportFormat, string>;

const EXPORT_CONTENT_TYPES = {
	ris: "application/x-research-info-systems; charset=utf-8",
	bibtex: "application/x-bibtex; charset=utf-8",
	atom: "application/atom+xml; charset=utf-8",
} as const satisfies Record<LibraryExportFormat, string>;

export function isLibraryExportFormat(
	value: string,
): value is LibraryExportFormat {
	return (LIBRARY_EXPORT_FORMATS as readonly string[]).includes(value);
}

export function isBibliographicExportFormat(
	value: string,
): value is BibliographicExportFormat {
	return (BIBLIOGRAPHIC_EXPORT_FORMATS as readonly string[]).includes(
		value,
	);
}

// The citation formats a reader may download. Single records and the whole
// library use the same list, so a switched-off format is offered nowhere.
export function getEnabledCitationFormats(
	exports: LibraryPublicConfig["exports"],
) {
	return BIBLIOGRAPHIC_EXPORT_FORMATS.filter(
		(format) => exports[format],
	);
}

/**
 * The citation files a single record page may advertise. A record page must
 * only point at a file the library actually serves, so a switched-off format
 * is listed nowhere.
 */
export function getRecordCitationLinks(
	exports: LibraryPublicConfig["exports"],
	downloadsEnabled: boolean,
	key: string,
) {
	if (!downloadsEnabled) return [];

	return getEnabledCitationFormats(exports).map((format) => ({
		contentType: getLibraryExportContentType(format).split(";", 1)[0],
		path: `/lib/${key}/export/${format}`,
	}));
}

// The whole-library file stops at the cap, so the download button must not
// promise more records than the file will hold.
export function getDownloadableRecordCount(totalRecords: number) {
	return Math.min(Math.max(0, totalRecords), LIBRARY_EXPORT_RECORD_CAP);
}

export function getLibraryExportPath(format: LibraryExportFormat) {
	return EXPORT_PATHS[format];
}

export function getLibraryExportContentType(format: LibraryExportFormat) {
	return EXPORT_CONTENT_TYPES[format];
}

export function getLibraryExportExtension(
	format: LibraryExportFormat,
) {
	return format === "bibtex" ? "bib" : format === "atom" ? "xml" : "ris";
}
