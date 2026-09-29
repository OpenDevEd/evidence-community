export const FULL_TEXT_PDF_ATTRIBUTE = "fullTextPDFs.fullTextPDF.text";
// Page numbers prove that extracted text exists without indexing page strings as filter values.
export const FULL_TEXT_PDF_PRESENCE_ATTRIBUTE = "fullTextPDFs.fullTextPDF.page";

/** Meilisearch filter for records that carry searchable PDF full text. */
export const FULL_TEXT_PDF_FILTER = `${FULL_TEXT_PDF_PRESENCE_ATTRIBUTE} EXISTS`;

/** True when a record has a public PDF, stored or linked, with or without extracted text. */
export const PDF_PRESENCE_ATTRIBUTE = "hasPdf";

/** Meilisearch filter for records with a PDF the AI can read. */
export const PDF_FILTER = `${PDF_PRESENCE_ATTRIBUTE} = true`;

/** The deepest search result anyone can reach (Meilisearch `maxTotalHits`). */
export const SEARCH_RESULT_LIMIT = 10_000_000;
