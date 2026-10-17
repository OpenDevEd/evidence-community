import { describe, expect, it } from "vitest";

import { projectSourcePdf, type SourceFileChoiceRow } from "@/lib/admin/source-file-choice";

const attachment = {
	key: "ZATT2345",
	sourceConnectionKey: "zotero-1",
	sourceRecordKey: "ZATT2345",
	itemType: "Attachment",
	deleted: 0,
	contentType: "application/pdf",
	linkMode: "imported_url",
	filename: "report.pdf",
	md5: "a".repeat(32),
	updatedAt: new Date("2026-10-16T00:00:00Z"),
} as Parameters<typeof projectSourcePdf>[0];
const config = { sources: [{ key: "zotero-1", provider: "zotero", settings: { downloadPdfs: true, pdfPublishing: { mode: "tagged", tags: ["_publish"] } } }] } as unknown as Parameters<typeof projectSourcePdf>[3];
const choice = (fields: Partial<SourceFileChoiceRow>): SourceFileChoiceRow => ({
	itemKey: "ZATT2345", sourceConnectionKey: "zotero-1", sourceRecordKey: "ZATT2345", choice: null, pending: null,
	reviewId: null, applied: true, sizeBytes: null, updatedAt: new Date("2026-10-16T01:00:00Z"), ...fields,
});

describe("how the admin shows a Zotero PDF", () => {
	it("shows an unpublished one with the tags that publish it", () => {
		expect(projectSourcePdf(attachment, undefined, false, config)).toMatchObject({ fileState: "unpublished", fileDraft: null, sourcePdf: { publishTags: ["_publish"] } });
	});

	it("shows a staged one as a staged file with its size in Zotero", () => {
		expect(projectSourcePdf(attachment, choice({ pending: "publish", sizeBytes: 2_048 }), false, config)).toMatchObject({ fileState: "staged", fileDraft: { filename: "report.pdf", expectedSizeBytes: 2_048 } });
	});

	it("shows one marked to come down as a pending removal of its published file", () => {
		expect(projectSourcePdf(attachment, choice({ pending: "withhold" }), true, config)).toMatchObject({ fileState: "published", fileRemovalPending: true });
	});

	it("shows an approved choice the import hasn't applied yet as processing", () => {
		expect(projectSourcePdf(attachment, choice({ choice: "publish", applied: false }), false, config)?.fileState).toBe("processing");
	});

	it("leaves another source's PDF, such as OpenAlex's, to the library's own file actions", () => {
		const openAlex = { sources: [{ key: "zotero-1", provider: "openalex", settings: {} }] } as unknown as Parameters<typeof projectSourcePdf>[3];
		expect(projectSourcePdf(attachment, undefined, false, openAlex)).toBeNull();
	});

	it("shows nothing for a PDF the library keeps itself", () => {
		expect(projectSourcePdf({ ...attachment!, sourceConnectionKey: "native" }, undefined, false, config)).toBeNull();
	});
});
