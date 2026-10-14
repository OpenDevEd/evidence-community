import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";

import type { LibraryServerConfig } from "../../src/config/library-config/schema";
import { itemDraft } from "@opendeved/evidence-library-core";
import { pdfImportFile } from "../../src/db/schema/pdf-import";
import { runPdfImportCycle } from "../../src/lib/admin/pdf-import-reading";
import { closePdfImport, commitPdfImport, confirmPdfImportUpload, failPdfImportUpload, pdfImportStatus, startPdfImport } from "../../src/lib/admin/pdf-import-service";
import { createPdf, MemoryFileStorage } from "../helpers/file-storage";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

vi.mock("server-only", () => ({}));
// The AI read is the one outside service here; everything around it runs on a real database.
const readImportPdf = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/admin/pdf-import", () => ({ readImportPdf }));

const EDITOR = "user_acceptance_admin";
const MAX_PDF_BYTES = 50 * 1024 * 1024;

test("reads uploaded PDFs on the worker, imports each once with its PDF, and removes the import's files when it closes", async () => {
	readImportPdf.mockResolvedValue({
		checks: [{ criterion: "Credits FCDO", page: 2, quote: "Funded by UK aid", recommendation: null, result: "met" }],
		cites: [],
		collections: [],
		// The AI names fields as Zotero does: a report's institution is the record's publisher.
		suggestions: [
			{ apply: true, checks: [], field: "institution", reason: "The PDF names its publisher on page 2.", value: "FCDO" },
			{ apply: true, checks: [], field: "language", reason: "The library writes language codes.", value: "en" },
		],
		topics: [],
		// No record type has a corporate author, and publishing needs a language code; the record takes both in the library's forms.
		zoteroItem: { creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }, { creatorType: "corporateAuthor", firstName: "Charles", lastName: "Babbage" }], itemType: "report", language: "English", title: "Girls' learning in Sierra Leone" },
	});
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const started = await startPdfImport(db, storage, { checks: ["Credits FCDO"], collections: [], createdBy: EDITOR, filenames: ["report.pdf", "lost.pdf"], instructions: "" });
		await expect(startPdfImport(db, storage, { checks: [], collections: [], createdBy: EDITOR, filenames: ["other.pdf"], instructions: "" })).rejects.toThrow("Another import is open");

		const [report, lost] = started.files;
		await storage.uploadPrivate(report!.upload.path, await createPdf("Girls' learning in Sierra Leone"), "application/pdf");
		await confirmPdfImportUpload(db, storage, report!.id);
		// This one reached storage, but its tab reloaded before saying so.
		await storage.uploadPrivate(lost!.upload.path, await createPdf("Lost"), "application/pdf");
		await failPdfImportUpload(db, lost!.id, "The connection dropped.");

		expect(await runPdfImportCycle(db, storage, {} as LibraryServerConfig)).toBe(true);
		// OpenScholar's author search answers the editor who started the import.
		expect(readImportPdf).toHaveBeenCalledOnce();
		expect(readImportPdf.mock.calls[0]![0]).toMatchObject({ clerkUserId: EDITOR });

		const status = await pdfImportStatus(db);
		const [read, failed] = status.import!.files;
		expect(read).toMatchObject({ state: "read", stored: true });
		expect(read!.reading!.record).toMatchObject({ payload: { creators: [{ creatorType: "author" }, { creatorType: "author", lastName: "Babbage" }], languageName: "en" }, state: "ready" });
		// The language suggestion changes nothing now, so only the publisher is left to apply.
		expect(read!.reading!.suggestions).toEqual([expect.objectContaining({ field: "publisher", value: "FCDO" })]);
		expect(failed).toMatchObject({ message: "The connection dropped.", state: "failed", stored: false });

		// The payload the review sends with the suggestion applied.
		const payload = { ...read!.reading!.record.payload, publisher: "FCDO" };
		const input = { collections: [], importId: started.id, records: [{ id: read!.rowId, method: "pdf" as const, payload }] };
		const first = await commitPdfImport(db, storage, MAX_PDF_BYTES, input);
		expect(first.results).toEqual([expect.objectContaining({ outcome: "created" })]);
		expect(first.attach).toEqual({ [read!.rowId]: "attached" });

		// A retried or second-tab commit carries on from the first instead of importing again.
		const again = await commitPdfImport(db, storage, MAX_PDF_BYTES, input);
		expect(again.results).toEqual(first.results);
		const draftKey = first.results[0]!.itemKey!;
		const [draft] = await db.select({ patch: itemDraft.patch }).from(itemDraft).where(eq(itemDraft.itemKey, draftKey));
		expect(draft!.patch).toMatchObject({ languageName: "en", title: "Girls' learning in Sierra Leone" });
		expect(await db.select().from(itemDraft).then((rows) => rows.filter(({ patch }) => (patch as { title?: string }).title === "Girls' learning in Sierra Leone"))).toHaveLength(1);

		await closePdfImport(db, storage, started.id);
		expect([...storage.privateFiles.keys()].filter((path) => path.startsWith(`imports/${started.id}/`))).toEqual([]);
		expect(await db.select().from(pdfImportFile).where(eq(pdfImportFile.importId, started.id))).toHaveLength(2);
		expect((await pdfImportStatus(db)).import).toBeNull();
	});
});

test("attaches each PDF once when two requests import at the same moment, and tries a failed one again with the same attachment", async () => {
	readImportPdf.mockResolvedValue({ checks: [], cites: [], collections: [], suggestions: [], topics: [], zoteroItem: { creators: [], itemType: "report", title: "A report" } });
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const started = await startPdfImport(db, storage, { checks: [], collections: [], createdBy: EDITOR, filenames: ["one.pdf", "two.pdf"], instructions: "" });
		for (const file of started.files) {
			await storage.uploadPrivate(file.upload.path, await createPdf(file.filename), "application/pdf");
			await confirmPdfImportUpload(db, storage, file.id);
		}
		await runPdfImportCycle(db, storage, {} as LibraryServerConfig);
		const files = (await pdfImportStatus(db)).import!.files;
		const input = { collections: [], importId: started.id, records: files.map((file) => ({ id: file.rowId, method: "pdf" as const, payload: file.reading!.record.payload! })) };

		// Storage refuses the second PDF's copy for the attachment every time these requests try it.
		const second = Buffer.from(storage.privateFiles.get(started.files[1]!.upload.path)!);
		const upload = storage.uploadPrivate.bind(storage);
		let refusing = true;
		vi.spyOn(storage, "uploadPrivate").mockImplementation(async (path, data, type) => {
			if (refusing && second.equals(Buffer.from(data))) throw new Error("Storage is down");
			return upload(path, data, type);
		});
		const both = await Promise.allSettled([commitPdfImport(db, storage, MAX_PDF_BYTES, input), commitPdfImport(db, storage, MAX_PDF_BYTES, input)]);
		expect(both.filter(({ status }) => status === "fulfilled").length).toBeGreaterThan(0);
		refusing = false;
		const retried = await commitPdfImport(db, storage, MAX_PDF_BYTES, input);
		expect(retried.attach).toEqual({ 1: "attached", 2: "attached" });

		// One attachment per PDF, however many requests touched it.
		const rows = await db.select({ attachmentKey: pdfImportFile.attachmentKey }).from(pdfImportFile).where(eq(pdfImportFile.importId, started.id));
		const attachments = await db.select({ patch: itemDraft.patch }).from(itemDraft);
		const keys = new Set(rows.map(({ attachmentKey }) => attachmentKey));
		expect(keys.size).toBe(2);
		expect(attachments.filter(({ patch }) => (patch as { itemType?: string }).itemType === "Attachment")).toHaveLength(2);
	});
}, 60_000);

test("finds a PDF that is the same file as one already in the library or earlier in the import", async () => {
	readImportPdf.mockResolvedValue({ checks: [], cites: [], collections: [], suggestions: [], topics: [], zoteroItem: { creators: [], itemType: "report", title: "A report without a DOI" } });
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const bytes = await createPdf("A report without a DOI");
		// An earlier import's draft, with this very PDF.
		const first = await startPdfImport(db, storage, { checks: [], collections: [], createdBy: EDITOR, filenames: ["report.pdf"], instructions: "" });
		await storage.uploadPrivate(first.files[0]!.upload.path, bytes, "application/pdf");
		await confirmPdfImportUpload(db, storage, first.files[0]!.id);
		await runPdfImportCycle(db, storage, {} as LibraryServerConfig);
		const [file] = (await pdfImportStatus(db)).import!.files;
		const done = await commitPdfImport(db, storage, MAX_PDF_BYTES, { collections: [], importId: first.id, records: [{ id: file!.rowId, method: "pdf", payload: file!.reading!.record.payload! }] });
		await closePdfImport(db, storage, first.id);

		const other = await createPdf("Another report");
		const second = await startPdfImport(db, storage, { checks: [], collections: [], createdBy: EDITOR, filenames: ["again.pdf", "other.pdf", "other copy.pdf"], instructions: "" });
		for (const [upload, pdf] of [[second.files[0]!, bytes], [second.files[1]!, other], [second.files[2]!, other]] as const) {
			await storage.uploadPrivate(upload.upload.path, pdf, "application/pdf");
			await confirmPdfImportUpload(db, storage, upload.id);
		}
		await runPdfImportCycle(db, storage, {} as LibraryServerConfig);
		const records = (await pdfImportStatus(db)).import!.files.map(({ reading }) => reading!.record);
		expect(records.map(({ state }) => state)).toEqual(["existing", "ready", "repeated"]);
		expect(records[0]!.existingKey).toBe(done.results[0]!.itemKey);
	});
}, 60_000);
