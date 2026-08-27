import { describe, expect, it, vi } from "vitest";

import { getTableColumns } from "drizzle-orm";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({
	getDatabaseForConfig: vi.fn(),
}));

import { CITATION_RECORD_COLUMNS } from "@/lib/library-export-records";
import { item } from "@/db/schema/tables/item";

const realColumns = new Set(Object.keys(getTableColumns(item)));

describe("citation record columns", () => {
	it("names only columns the record table really has", () => {
		const unknownColumns = CITATION_RECORD_COLUMNS.filter(
			(column) => !realColumns.has(column),
		);

		expect(unknownColumns).toEqual([]);
	});

	// Stored full text and cover images are large and belong to no citation.
	// An export must never read them, whatever the search index or database
	// happens to be set up to return.
	it.each([
		"fullTextPDF",
		"PDFCoverPageImage",
		"PDFCoverPageWidth",
		"PDFCoverPageHeight",
		"note",
		"annotationText",
		"annotationComment",
		"annotationPosition",
		"filename",
		"md5",
		"contentType",
	])("never reads %s", (column) => {
		expect(realColumns.has(column)).toBe(true);
		expect(CITATION_RECORD_COLUMNS).not.toContain(column);
	});

	it("still reads the fields a citation needs", () => {
		for (const column of [
			"key",
			"itemType",
			"title",
			"creators",
			"date",
			"DOI",
			"url",
			"publisher",
			"publicationTitle",
			"pages",
			"volume",
			"issue",
			"ISBN",
			"ISSN",
			"abstractNote",
			"extra",
		]) {
			expect(CITATION_RECORD_COLUMNS).toContain(column);
		}
	});
});
