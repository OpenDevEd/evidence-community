import { expect, it } from "vitest";
import { isVisiblePdfAttachment } from "@/lib/attachment-visibility";

const pdfLink = {
	linkMode: "linked_url",
	contentType: "application/pdf",
	url: "https://journal.example/paper.pdf",
};

it("shows a PDF with a cover or a published PDF link", () => {
	expect(isVisiblePdfAttachment({ PDFCoverPageImage: "https://files.example/cover.png" })).toBe(true);
	expect(isVisiblePdfAttachment(pdfLink)).toBe(true);
	expect(isVisiblePdfAttachment({ ...pdfLink, contentType: "application/PDF" })).toBe(true);
});

it("hides coverless files, unpublished links and links to other content", () => {
	// Sources clear the URL of an attachment they have not published.
	expect(isVisiblePdfAttachment({ ...pdfLink, url: null })).toBe(false);
	expect(isVisiblePdfAttachment({ ...pdfLink, contentType: "text/html" })).toBe(false);
	expect(isVisiblePdfAttachment({ ...pdfLink, linkMode: "imported_url" })).toBe(false);
	expect(isVisiblePdfAttachment({ ...pdfLink, url: "file:///paper.pdf" })).toBe(false);
});
