export const FULL_TEXT_PDF_ATTRIBUTE = "fullTextPDFs.fullTextPDF.text";
// Page numbers prove that extracted text exists without indexing page strings as filter values.
export const FULL_TEXT_PDF_PRESENCE_ATTRIBUTE = "fullTextPDFs.fullTextPDF.page";

/** True when a record has a public PDF, stored or linked, with or without extracted text. */
export const PDF_PRESENCE_ATTRIBUTE = "hasPdf";

/** The words at the start of a title that `title.start` holds, where a search's words rank highest. */
export const TITLE_START_WORDS = 4;

/** The sources that still hold a record, by key, which readers filter by. */
export const SOURCES_FIELD = "sources";

/**
 * The results a page number reaches in each engine. Elasticsearch pages by offset only through its
 * `index.max_result_window`; past that, a page continues from a cursor, the place of the record before it. Meilisearch
 * counts and pages to the `maxTotalHits` its worker sets, so every result of a library above a million records has a page.
 */
export const SEARCH_RESULT_LIMITS = { elasticsearch: 10_000, meilisearch: 10_000_000 } as const;

/**
 * The results a library's page numbers reach. While a switch runs, readers can be on either engine, so a library with
 * an Elasticsearch connection keeps to Elasticsearch's limit, and so does a caller that names no connections.
 */
export function libraryResultLimit(services?: { search: { elasticsearch?: unknown } }) {
	return services && !services.search.elasticsearch ? SEARCH_RESULT_LIMITS.meilisearch : SEARCH_RESULT_LIMITS.elasticsearch;
}
