import type {
	LibraryPublicConfig,
	LibraryServerConfig,
} from "./schema";

export const BIBLIOGRAPHIC_EXPORT_FORMATS = [
	"ris",
	"bibtex",
] as const;
export const LIBRARY_EXPORT_FORMATS = [
	...BIBLIOGRAPHIC_EXPORT_FORMATS,
	"atom",
] as const;

export type BibliographicExportFormat =
	(typeof BIBLIOGRAPHIC_EXPORT_FORMATS)[number];
export type LibraryExportFormat =
	(typeof LIBRARY_EXPORT_FORMATS)[number];

const EXPORT_PATHS = {
	ris: "/lib/export/ris",
	bibtex: "/lib/export/bibtex",
	atom: "/lib/atom.xml",
} as const satisfies Record<LibraryExportFormat, string>;

const APPROVED_CONTENT_TYPES = {
	ris: new Set([
		"application/x-research-info-systems",
		"application/x-research-info-system",
		"text/plain",
	]),
	bibtex: new Set([
		"application/x-bibtex",
		"text/bibtex",
		"text/x-bibtex",
		"text/plain",
	]),
	atom: new Set([
		"application/atom+xml",
		"application/xml",
		"text/xml",
	]),
} satisfies Record<LibraryExportFormat, ReadonlySet<string>>;

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

// Whole-library RIS and BibTeX files come from an address in the
// configuration. Single-record downloads are built from the database and do
// not use this list.
export function getWholeLibraryFileFormats(
	exports: LibraryPublicConfig["exports"],
) {
	return BIBLIOGRAPHIC_EXPORT_FORMATS.filter(
		(format) => exports[format],
	);
}

export function getLibraryExportPath(format: LibraryExportFormat) {
	return EXPORT_PATHS[format];
}

export function getLibraryExportSourceUrl(
	exports: LibraryServerConfig["exports"],
	format: LibraryExportFormat,
) {
	return exports[format];
}

export function isApprovedLibraryExportContentType(
	format: LibraryExportFormat,
	contentType: string | null,
) {
	if (!contentType) return false;

	const normalizedContentType =
		contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	return APPROVED_CONTENT_TYPES[format].has(normalizedContentType);
}

export function getLibraryExportExtension(
	format: LibraryExportFormat,
) {
	return format === "bibtex" ? "bib" : format === "atom" ? "xml" : "ris";
}
