import { expect, it } from "vitest";
import { isVisiblePdfAttachment } from "@/lib/attachment-visibility";

it("shows URL-only PDFs without a cover or processing tag, but excludes ordinary links", () => {
	expect(
		isVisiblePdfAttachment({
			url: "https://journal.example/paper.pdf",
			contentType: "application/pdf",
		}),
	).toBe(true);
	expect(
		isVisiblePdfAttachment({
			url: "https://journal.example",
			contentType: "text/html",
		}),
	).toBe(false);
	expect(isVisiblePdfAttachment({ contentType: "application/pdf" })).toBe(
		false,
	);
	expect(
		isVisiblePdfAttachment({
			PDFCoverPageImage: "https://files.example/cover.png",
		}),
	).toBe(true);
});
