import { expect, it } from "vitest";
import { filesHiddenFor, filterPublicAttachments, isVisiblePdfAttachment } from "@/lib/attachment-visibility";

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

it("keeps a record's own files from readers while it keeps them private, and its links to files elsewhere", () => {
	const stored = { key: "PDF00001", deleted: 0, itemType: "Attachment", linkMode: "imported_file", PDFCoverPageImage: "https://files.example/cover.png", tags: [] };
	const link = { key: "LINK0001", deleted: 0, itemType: "Attachment", ...pdfLink, tags: [] };
	const rules = { hidden: [], publishBySource: {} };
	const record = { licence: { kind: "zenodo", id: "cc-by-4.0" }, fileAccess: { mode: "private" } };
	expect(filesHiddenFor(record, "2026-11-19")).toBe(true);
	expect(filterPublicAttachments({ ...record, attachmentsData: [stored, link], sourceConnectionKey: "native" }, rules)?.map(({ key }) => key)).toEqual(["LINK0001"]);
	// An embargoed record's files show from their day, read when the record is read.
	const embargoed = { ...record, fileAccess: { mode: "embargo", until: "2027-06-01" } };
	expect(filesHiddenFor(embargoed, "2027-05-31")).toBe(true);
	expect(filesHiddenFor(embargoed, "2027-06-01")).toBe(false);
	// A record from elsewhere, with no licence of its own, keeps its files as before.
	expect(filesHiddenFor({}, "2026-11-19")).toBe(false);
});
