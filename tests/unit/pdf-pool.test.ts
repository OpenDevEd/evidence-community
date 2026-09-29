import { describe, expect, it } from "vitest";

import { processPdfInWorkers } from "@/lib/admin/pdf-pool";
import { InvalidPdfError } from "@/lib/admin/pdf-processing";
import { createPdf } from "../helpers/file-storage";

describe("processPdfInWorkers", () => {
	it("reads several PDFs at once in worker threads, each with its own text", async () => {
		const pdfs = await Promise.all(Array.from({ length: 6 }, (_, index) => createPdf(`Document ${index}`)));
		const sizes = pdfs.map((pdf) => pdf.byteLength);
		const read = await Promise.all(pdfs.map((pdf) => processPdfInWorkers(pdf)));
		expect(read.map((pdf) => pdf.text.includes(`Document ${read.indexOf(pdf)}`))).toEqual(Array(6).fill(true));
		expect(read.every((pdf) => pdf.pageCount === 1 && pdf.coverWidth === 1600 && pdf.cover.byteLength > 0)).toBe(true);
		// The caller keeps its bytes.
		expect(pdfs.map((pdf) => pdf.byteLength)).toEqual(sizes);
	});

	it("gives the same errors as reading in this thread", async () => {
		await expect(processPdfInWorkers(new TextEncoder().encode("not a pdf"))).rejects.toThrow(new InvalidPdfError("Choose a valid PDF file."));
		await expect(processPdfInWorkers(new TextEncoder().encode("%PDF-1.7 broken"))).rejects.toThrow(
			new InvalidPdfError("This PDF could not be processed. Try exporting it again or choose another file."),
		);
	});
});
