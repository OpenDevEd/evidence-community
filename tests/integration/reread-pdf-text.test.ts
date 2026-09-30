import { eq } from "drizzle-orm";
import { outbox } from "@opendeved/evidence-library-core";
import { fetch as transport, Response } from "undici";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("undici", async (importOriginal) => ({
	...(await importOriginal<typeof import("undici")>()),
	fetch: vi.fn(),
}));

import { sourceConnection } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { rereadNearlyEmptyPdfText } from "@/lib/admin/reread-pdf-text";
import { createOpenAlexAttachmentProcessor } from "@/lib/source-ingestion/openalex/attachment-processor";
import { mapOpenAlexWork } from "@/lib/source-ingestion/openalex/mapper";
import { writeSourceIngestionBatch } from "@/lib/source-ingestion/transactional-writer";
import { MemoryFileStorage } from "../helpers/file-storage";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

/** A one-page PDF with a line of text per entry, well over the hundred letters a nearly empty text has. */
async function pdfWithLines(lines: string[]) {
	const document = await PDFDocument.create();
	const font = await document.embedFont(StandardFonts.Helvetica);
	const page = document.addPage([612, 792]);
	lines.forEach((line, index) => page.drawText(line, { x: 72, y: 700 - index * 24, size: 14, font }));
	return document.save();
}

it("reads a published PDF with nearly empty saved text again, saves the text and reindexes it with its parent", async () => {
	await withIsolatedPublicationDatabase(async (database) => {
		await database.insert(sourceConnection).values({ key: "openalex-reread", provider: "openalex", scopeKind: "query", config: { downloadPdfs: true } });
		const storage = new MemoryFileStorage();
		const processor = createOpenAlexAttachmentProcessor({ database, storage, maxPdfBytes: 1_000_000 });
		const [parent, attachment] = mapOpenAlexWork({
			id: "https://openalex.org/W987",
			title: "Research read again",
			type: "article",
			updated_date: "2026-09-30T00:00:00Z",
			best_oa_location: { is_oa: true, pdf_url: "https://93.184.216.34/reread.pdf", version: "publishedVersion" },
		}).items;
		vi.mocked(transport).mockResolvedValueOnce(new Response(await pdfWithLines(["Vocational training research in technical colleges", "Apprenticeships and work placements across regions", "Teacher preparation for technical and vocational schools"]), { headers: { "content-type": "application/pdf" } }));
		const published = await processor(attachment!, "openalex-reread");
		await writeSourceIngestionBatch(database, { sourceConnectionKey: "openalex-reread", expectedCursor: {}, nextCursor: {}, mappingProfileVersion: "test", fetchedAt: new Date(), items: [parent, published] });
		await processor.flushCleanup("openalex-reread");

		const [saved] = await database.select({ key: item.key, parent: item.parentItem }).from(item).where(eq(item.itemType, "Attachment"));
		// As a reader without its character maps left a Chinese PDF: page markers and no words.
		await database.update(item).set({ fullTextPDF: "**|| PAGE 1 ||**" }).where(eq(item.key, saved!.key));
		const eventsBefore = await database.select().from(outbox);

		expect(await rereadNearlyEmptyPdfText(database, storage)).toEqual({ checked: 1, updated: 1, failed: 0 });
		const [reread] = await database.select({ text: item.fullTextPDF }).from(item).where(eq(item.key, saved!.key));
		expect(reread?.text).toContain("Vocational training research");
		const events = (await database.select().from(outbox)).slice(eventsBefore.length);
		expect(events.map((event) => [event.entityKey, event.operation]).sort()).toEqual([[saved!.key, "upsert"], [saved!.parent, "upsert"]].sort());

		// Text that is already there is not read again.
		expect(await rereadNearlyEmptyPdfText(database, storage)).toEqual({ checked: 0, updated: 0, failed: 0 });
	});
}, 120_000);
