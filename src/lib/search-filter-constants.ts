export const FULL_TEXT_PDF_ATTRIBUTE = "fullTextPDFs.fullTextPDF.text";
// Page numbers prove that extracted text exists without indexing page strings as filter values.
export const FULL_TEXT_PDF_PRESENCE_ATTRIBUTE = "fullTextPDFs.fullTextPDF.page";

/** Meilisearch filter for records that carry searchable PDF full text. */
export const FULL_TEXT_PDF_FILTER = `${FULL_TEXT_PDF_PRESENCE_ATTRIBUTE} EXISTS`;
