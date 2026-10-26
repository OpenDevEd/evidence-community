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
 * The results a page number reaches: Elasticsearch pages by offset only this far (its `index.max_result_window`).
 * Past them, a page continues from a cursor, the place of the record before it.
 */
export const SEARCH_RESULT_LIMIT = 10_000;
