import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";

import { libraryConfigSchema, type LibraryServerConfig } from "../../src/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { routeChoice } from "../../src/lib/admin/review-contract";
import { getItemPublishingChoice, setItemPublishingChoice, submitItemReview } from "../../src/lib/admin/review-service";
import { itemDraft, itemFileDraft } from "@opendeved/evidence-library-core";
import { pdfImport, pdfImportFile } from "../../src/db/schema/pdf-import";
import { itemReview } from "../../src/db/schema/review";
import { item } from "../../src/db/schema/tables/item";
import { importChecksOf } from "../../src/lib/admin/import-checks";
import { completeNativePdfUpload, stageNativePdfUpload } from "../../src/lib/admin/native-file-service";
import { runPdfImportCycle } from "../../src/lib/admin/pdf-import-reading";
import { closePdfImport, commitPdfImport, confirmPdfImportUpload, failPdfImportUpload, pdfImportStatus, readPdfImportFile, startPdfImport } from "../../src/lib/admin/pdf-import-service";
import { createPdf, MemoryFileStorage } from "../helpers/file-storage";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

vi.mock("server-only", () => ({}));
// The AI read is the one outside service here; everything around it runs on a real database.
const readImportPdf = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/admin/pdf-import", () => ({ readImportPdf }));

const EDITOR = "user_acceptance_admin";
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const config = { services: { storage: { maxPdfBytes: MAX_PDF_BYTES } } } as LibraryServerConfig;
const pdfFile = (name: string) => ({ name, size: 1_000 });
type Database = Parameters<typeof pdfImportStatus>[0];

// The worker retries a failed attachment later; a test makes it due now.
const dueNow = (db: Database, importId: string) => db.update(pdfImportFile).set({ nextAttemptAt: new Date(0) }).where(eq(pdfImportFile.importId, importId));

test("reads uploaded PDFs on the worker, imports each once, attaches its PDF, and removes the import's files when it closes", async () => {
	readImportPdf.mockReset().mockResolvedValue({
		checks: [{ criterion: "Credits FCDO", page: 2, quote: "Funded by UK aid", recommendation: null, result: "met" }],
		cites: [],
		collections: [],
		// The AI names fields as Zotero does: a report's institution is the record's publisher.
		suggestions: [
			{ apply: true, checks: [], field: "institution", reason: "The PDF names its publisher on page 2.", value: "FCDO" },
			{ apply: true, checks: [], field: "language", reason: "The library writes language codes.", value: "English" },
		],
		topics: [],
		// No record type has a corporate author, and publishing needs a language code; the record takes both in the library's forms.
		zoteroItem: { creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }, { creatorType: "corporateAuthor", firstName: "Charles", lastName: "Babbage" }], itemType: "report", language: "English", title: "Girls' learning in Sierra Leone" },
	});
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		await expect(startPdfImport(db, storage, MAX_PDF_BYTES, { checks: [], collections: [], createdBy: EDITOR, files: [{ name: "huge.pdf", size: MAX_PDF_BYTES + 1 }], instructions: "" })).rejects.toThrow("larger than the community takes");
		const started = await startPdfImport(db, storage, MAX_PDF_BYTES, { checks: ["Credits FCDO"], collections: [], createdBy: EDITOR, files: [pdfFile("report.pdf"), pdfFile("lost.pdf")], instructions: "" });
		await expect(startPdfImport(db, storage, MAX_PDF_BYTES, { checks: [], collections: [], createdBy: EDITOR, files: [pdfFile("other.pdf")], instructions: "" })).rejects.toThrow("Another import is open");

		const [report, lost] = started.files;
		await storage.uploadPrivate(report!.upload.path, await createPdf("Girls' learning in Sierra Leone"), "application/pdf");
		await confirmPdfImportUpload(db, storage, report!.id);
		// This one reached storage, but its tab reloaded before saying so.
		await storage.uploadPrivate(lost!.upload.path, await createPdf("Lost"), "application/pdf");
		await failPdfImportUpload(db, lost!.id, "The connection dropped.");

		expect(await runPdfImportCycle(db, storage, config)).toBe(true);
		const readBy = Date.now();
		// OpenScholar's author search answers the editor who started the import.
		expect(readImportPdf).toHaveBeenCalledOnce();
		expect(readImportPdf.mock.calls[0]![0]).toMatchObject({ clerkUserId: EDITOR });

		const status = await pdfImportStatus(db);
		const [read, failed] = status.import!.files;
		expect(read).toMatchObject({ state: "read", stored: true });
		expect(read!.reading!.record).toMatchObject({ payload: { creators: [{ creatorType: "author" }, { creatorType: "author", lastName: "Babbage" }], languageName: "en" }, state: "ready" });
		// The language suggestion becomes a code too, which changes nothing now, so only the publisher is left to apply.
		expect(read!.reading!.suggestions).toEqual([expect.objectContaining({ field: "publisher", value: "FCDO" })]);
		expect(failed).toMatchObject({ message: "The connection dropped.", state: "failed", stored: false });

		// The payload the review sends with the suggestion applied.
		const payload = { ...read!.reading!.record.payload, publisher: "FCDO" };
		const input = { collections: [], importId: started.id, records: [{ id: read!.rowId, method: "pdf" as const, payload }] };
		const first = await commitPdfImport(db, input);
		expect(first.results).toEqual([expect.objectContaining({ outcome: "created" })]);
		// A retried or second-tab commit gets the records already made instead of importing again.
		expect((await commitPdfImport(db, input)).results).toEqual(first.results);
		const draftKey = first.results[0]!.itemKey!;
		const [draft] = await db.select({ patch: itemDraft.patch }).from(itemDraft).where(eq(itemDraft.itemKey, draftKey));
		expect(draft!.patch).toMatchObject({ languageName: "en", title: "Girls' learning in Sierra Leone" });
		// The PDF has no date: a DOI needs one, publishing without a DOI doesn't, so the finish step holds the draft only on a DOI route.
		const needs = (await pdfImportStatus(db)).import!.needs[read!.rowId];
		expect(needs).toMatchObject({ zenodo: { date: expect.any(String) } });
		expect(needs).not.toHaveProperty("none");

		// The worker attaches from the import's stored PDF, so the import stays open until it has.
		await expect(closePdfImport(db, storage, started.id)).rejects.toThrow("still getting their PDFs");
		await runPdfImportCycle(db, storage, config);
		expect((await pdfImportStatus(db)).import!.attach).toEqual({ [read!.rowId]: "attached" });
		const attachments = (await db.select({ patch: itemDraft.patch }).from(itemDraft)).filter(({ patch }) => (patch as { parentItem?: string }).parentItem === draftKey);
		expect(attachments).toHaveLength(1);

		// Published from another tab: every tab's status says so.
		await db.insert(item).values({ itemType: "Report", key: draftKey, sourceConnectionKey: "native", sourceRecordKey: draftKey, title: "Girls' learning in Sierra Leone" });
		const published = (await pdfImportStatus(db)).import!;
		expect(published.sent).toEqual({ [read!.rowId]: "published" });
		// A draft sent on is no longer held back for what it needs.
		expect(published.needs).toEqual({});

		await closePdfImport(db, storage, started.id);
		expect([...storage.privateFiles.keys()].filter((path) => path.startsWith(`imports/${started.id}/`))).toEqual([]);
		expect((await pdfImportStatus(db)).import).toBeNull();
		await expect(readPdfImportFile(db, storage, report!.id)).rejects.toThrow("not uploaded");

		// The checks the PDF was read against stay with the record after the import is closed. The PDF opened on its own
		// has none: they are on the record's fields.
		const kept = { checks: [expect.objectContaining({ criterion: "Credits FCDO", result: "met" })], filename: "report.pdf" };
		const checksOfRecord = await importChecksOf(db, draftKey);
		expect(checksOfRecord).toMatchObject(kept);
		// Dated when the AI read the PDF, not when it was attached.
		expect(Date.parse(checksOfRecord!.readAt)).toBeLessThanOrEqual(readBy);
		const [{ attachmentKey }] = await db.select({ attachmentKey: pdfImportFile.attachmentKey }).from(pdfImportFile).where(eq(pdfImportFile.id, report!.id));
		expect(await importChecksOf(db, attachmentKey!)).toBeNull();
		// Another PDF uploaded in its place hasn't been checked, so the record no longer shows them.
		const replacement = await createPdf("A different report");
		const staged = await stageNativePdfUpload(db, storage, { expectedSha256: createHash("sha256").update(replacement).digest("hex"), expectedSizeBytes: replacement.byteLength, filename: "replacement.pdf", itemKey: attachmentKey!, maxPdfBytes: MAX_PDF_BYTES });
		await storage.uploadPrivate(staged.fileDraft.objectPath, replacement, "application/pdf");
		await completeNativePdfUpload(db, storage, { expectedUploadRevision: staged.fileDraft.uploadRevision, itemKey: attachmentKey!, maxPdfBytes: MAX_PDF_BYTES });
		expect(await importChecksOf(db, draftKey)).toBeNull();
	});
});

// PDFs reach storage seconds apart, so most of an import arrives after the worker's cycle has started.
test("reads a PDF that arrives while another is being read, without waiting for that read to end", async () => {
	let finishFirst = () => {};
	const reading = { checks: [], cites: [], collections: [], suggestions: [], topics: [], zoteroItem: { creators: [], itemType: "report", title: "A report" } };
	readImportPdf.mockReset().mockImplementationOnce(() => new Promise((resolve) => (finishFirst = () => resolve(reading)))).mockResolvedValue(reading);
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const started = await startPdfImport(db, storage, MAX_PDF_BYTES, { checks: [], collections: [], createdBy: EDITOR, files: [pdfFile("first.pdf"), pdfFile("later.pdf")], instructions: "" });
		const arrive = async (index: number) => {
			const file = started.files[index]!;
			await storage.uploadPrivate(file.upload.path, await createPdf(file.filename), "application/pdf");
			await confirmPdfImportUpload(db, storage, file.id);
		};
		await arrive(0);
		const cycle = runPdfImportCycle(db, storage, config);
		await vi.waitFor(() => expect(readImportPdf).toHaveBeenCalledOnce());
		await arrive(1);
		await vi.waitFor(() => expect(readImportPdf).toHaveBeenCalledTimes(2), { timeout: 10_000 });
		finishFirst();
		await cycle;
		expect((await pdfImportStatus(db)).import!.files.map(({ state }) => state)).toEqual(["read", "read"]);
	});
});

test("imports the records once when two requests come at the same moment, and attaches a PDF whose first try failed with the same attachment", async () => {
	readImportPdf.mockReset().mockResolvedValue({ checks: [], cites: [], collections: [], suggestions: [], topics: [], zoteroItem: { creators: [], itemType: "report", title: "A report" } });
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		// A browser can send a PDF under a name without .pdf; it still attaches.
		const started = await startPdfImport(db, storage, MAX_PDF_BYTES, { checks: [], collections: [], createdBy: EDITOR, files: [pdfFile("one"), pdfFile("two.pdf")], instructions: "" });
		for (const file of started.files) {
			await storage.uploadPrivate(file.upload.path, await createPdf(file.filename), "application/pdf");
			await confirmPdfImportUpload(db, storage, file.id);
		}
		await runPdfImportCycle(db, storage, config);
		const files = (await pdfImportStatus(db)).import!.files;
		const input = { collections: [], importId: started.id, records: files.map((file) => ({ id: file.rowId, method: "pdf" as const, payload: file.reading!.record.payload! })) };

		const both = await Promise.allSettled([commitPdfImport(db, input), commitPdfImport(db, input)]);
		expect(both.filter(({ status }) => status === "fulfilled").length).toBeGreaterThan(0);
		const drafts = (await db.select({ patch: itemDraft.patch }).from(itemDraft)).filter(({ patch }) => (patch as { title?: string }).title === "A report");
		expect(drafts).toHaveLength(2);

		// Storage refuses the second PDF's copy for its attachment, once.
		const second = Buffer.from(storage.privateFiles.get(started.files[1]!.upload.path)!);
		const upload = storage.uploadPrivate.bind(storage);
		let refusals = 1;
		vi.spyOn(storage, "uploadPrivate").mockImplementation(async (path, data, type) => {
			if (refusals > 0 && second.equals(Buffer.from(data))) {
				refusals -= 1;
				throw new Error("Storage is down");
			}
			return upload(path, data, type);
		});
		await runPdfImportCycle(db, storage, config);
		expect((await pdfImportStatus(db)).import!.attach).toEqual({ 1: "attached" });
		await dueNow(db, started.id);
		await runPdfImportCycle(db, storage, config);
		expect((await pdfImportStatus(db)).import!.attach).toEqual({ 1: "attached", 2: "attached" });

		// One attachment per PDF, however many tries it took.
		const attachments = (await db.select({ patch: itemDraft.patch }).from(itemDraft)).filter(({ patch }) => (patch as { itemType?: string }).itemType === "Attachment");
		expect(attachments).toHaveLength(2);
	});
}, 60_000);

test("finds a PDF that is the same file as one already in the library or earlier in the import, without asking the AI", async () => {
	readImportPdf.mockReset().mockResolvedValue({ checks: [], cites: [], collections: [], suggestions: [], topics: [], zoteroItem: { creators: [], itemType: "report", title: "A report without a DOI" } });
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const bytes = await createPdf("A report without a DOI");
		// An earlier import's draft, with this very PDF.
		const first = await startPdfImport(db, storage, MAX_PDF_BYTES, { checks: [], collections: [], createdBy: EDITOR, files: [pdfFile("report.pdf")], instructions: "" });
		await storage.uploadPrivate(first.files[0]!.upload.path, bytes, "application/pdf");
		await confirmPdfImportUpload(db, storage, first.files[0]!.id);
		await runPdfImportCycle(db, storage, config);
		const [file] = (await pdfImportStatus(db)).import!.files;
		const done = await commitPdfImport(db, { collections: [], importId: first.id, records: [{ id: file!.rowId, method: "pdf", payload: file!.reading!.record.payload! }] });
		await runPdfImportCycle(db, storage, config);
		await closePdfImport(db, storage, first.id);
		// Publishing moves the upload out of the drafts and writes the record into a new copy, whose hash differs.
		await db.delete(itemFileDraft);

		readImportPdf.mockClear();
		const other = await createPdf("Another report");
		const second = await startPdfImport(db, storage, MAX_PDF_BYTES, { checks: [], collections: [], createdBy: EDITOR, files: [pdfFile("again.pdf"), pdfFile("other.pdf"), pdfFile("other copy.pdf")], instructions: "" });
		for (const [upload, pdf] of [[second.files[0]!, bytes], [second.files[1]!, other], [second.files[2]!, other]] as const) {
			await storage.uploadPrivate(upload.upload.path, pdf, "application/pdf");
			await confirmPdfImportUpload(db, storage, upload.id);
		}
		await runPdfImportCycle(db, storage, config);
		const records = (await pdfImportStatus(db)).import!.files.map(({ reading }) => reading!.record);
		// Of the two copies read at the same moment, whichever the worker hashed first reads; the other repeats it.
		expect(records[0]!.state).toBe("existing");
		expect(records.slice(1).map(({ state }) => state).sort()).toEqual(["ready", "repeated"]);
		expect(records[0]).toMatchObject({ existingKey: done.results[0]!.itemKey, title: "A report without a DOI" });
		// The file already in the library cost no read, and of two copies read at the same moment only one went to the AI.
		const read = readImportPdf.mock.calls.map(([, { filename }]) => filename);
		expect(read).not.toContain("again.pdf");
		expect(read.filter((filename) => filename.startsWith("other"))).toHaveLength(1);
	});
}, 60_000);

test("doesn't read a PDF larger than the library takes", async () => {
	readImportPdf.mockReset();
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const small = { services: { storage: { maxPdfBytes: 100 } } } as LibraryServerConfig;
		const started = await startPdfImport(db, storage, MAX_PDF_BYTES, { checks: [], collections: [], createdBy: EDITOR, files: [pdfFile("report.pdf")], instructions: "" });
		await storage.uploadPrivate(started.files[0]!.upload.path, await createPdf("A long report"), "application/pdf");
		await confirmPdfImportUpload(db, storage, started.files[0]!.id);
		await runPdfImportCycle(db, storage, small);
		// It fails for good at once: trying again can't make it smaller.
		expect((await pdfImportStatus(db)).import!.files[0]).toMatchObject({ message: expect.stringContaining("larger than the community takes"), state: "failed" });
		expect(readImportPdf).not.toHaveBeenCalled();
	});
});

test("won't close an import while its records are being imported, and waits for a slow tab while its PDFs keep arriving", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const started = await startPdfImport(db, storage, MAX_PDF_BYTES, { checks: [], collections: [], createdBy: EDITOR, files: [pdfFile("first.pdf"), pdfFile("second.pdf")], instructions: "" });
		// Started 20 minutes ago, and its tab is still sending: the first PDF arrived a moment ago.
		await db.update(pdfImport).set({ createdAt: new Date(Date.now() - 20 * 60_000) }).where(eq(pdfImport.id, started.id));
		await storage.uploadPrivate(started.files[0]!.upload.path, await createPdf("First"), "application/pdf");
		await confirmPdfImportUpload(db, storage, started.files[0]!.id);
		expect((await pdfImportStatus(db)).import!.files[1]).toMatchObject({ state: "uploading" });

		// Another tab is importing the records right now.
		await db.update(pdfImport).set({ commitStartedAt: new Date() }).where(eq(pdfImport.id, started.id));
		await expect(closePdfImport(db, storage, started.id)).rejects.toThrow("being imported");
	});
});

// An import that sends its drafts on publishes each one that can go once its PDF is attached, as the editor who imported
// it, and holds one that lacks what its DOI route needs, saying why, without saving a route or reserving anything for it.
const fullConfig = libraryConfigSchema.parse(maximalLibraryConfig);
const SEND = { actor: { role: "editor" as const, userId: EDITOR }, route: "zenodo" as const };

/** Reads the PDFs (dated.pdf has a date, any other none; each names CC BY 4.0 as its licence) and imports them all, to be sent on with Zenodo DOIs. */
async function importToSend(db: Database, storage: MemoryFileStorage, names: string[], send: { actor: typeof SEND.actor; route: typeof SEND.route; publish?: boolean } = SEND) {
	const reading = (title: string, date?: string) => ({ checks: [], cites: [], collections: [], suggestions: [], topics: [], zoteroItem: { abstractNote: "What the report found.", rights: "© 2026 The authors. Licensed under CC BY 4.0.", creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }], itemType: "report", title, ...(date ? { date } : {}) } });
	readImportPdf.mockReset().mockImplementation(async (_: unknown, { filename }: { filename: string }) => (filename === "dated.pdf" ? reading("A dated report", "2024-06-12") : reading("An undated report")));
	const started = await startPdfImport(db, storage, MAX_PDF_BYTES, { checks: [], collections: [], createdBy: EDITOR, files: names.map(pdfFile), instructions: "" });
	for (const file of started.files) {
		await storage.uploadPrivate(file.upload.path, await createPdf(file.filename), "application/pdf");
		await confirmPdfImportUpload(db, storage, file.id);
	}
	await runPdfImportCycle(db, storage, fullConfig);
	const files = (await pdfImportStatus(db)).import!.files;
	const records = files.map((file) => ({ id: file.rowId, method: "pdf" as const, payload: file.reading!.record.payload! }));
	const { results } = await commitPdfImport(db, { collections: [], importId: started.id, records, send });
	return { files, importId: started.id, keyOf: (row: string) => results.find(({ id }) => id === row)!.itemKey! };
}

test("sends the imported drafts on once their PDFs are attached, and holds one its DOI route can't take", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { files, importId, keyOf } = await importToSend(db, storage, ["dated.pdf", "undated.pdf"]);
		// The worker attaches each PDF, then sends its draft on.
		await runPdfImportCycle(db, storage, fullConfig);
		await runPdfImportCycle(db, storage, fullConfig);

		const status = (await pdfImportStatus(db)).import!;
		const rowOf = (name: string) => files.find((file) => file.filename === name)!.rowId;
		expect(status.send).toEqual({ action: "publish", route: "zenodo" });
		expect(status.sent).toEqual({ [rowOf("dated.pdf")]: "published" });
		expect(status.sending).toEqual({ [rowOf("undated.pdf")]: { message: expect.stringMatching(/date/iu), state: "held" } });
		expect((await getItemPublishingChoice(db, keyOf(rowOf("undated.pdf")), fullConfig)).choice).toBeNull();
		// The import stays open until nothing waits to be sent; then it closes.
		await closePdfImport(db, storage, importId);
	});
});

test("sends an editor's drafts to the review queue when the editor chose the queue over publishing", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { files, importId, keyOf } = await importToSend(db, storage, ["dated.pdf"], { ...SEND, publish: false });
		await runPdfImportCycle(db, storage, fullConfig);
		await runPdfImportCycle(db, storage, fullConfig);

		const itemKey = keyOf(files[0]!.rowId);
		expect((await pdfImportStatus(db)).import!.send).toEqual({ action: "submit", route: "zenodo" });
		expect(await db.select({ key: item.key }).from(item).where(eq(item.key, itemKey))).toEqual([]);
		expect(await db.select({ state: itemReview.state, submittedBy: itemReview.submittedBy }).from(itemReview).where(eq(itemReview.itemKey, itemKey))).toEqual([{ state: "pending", submittedBy: EDITOR }]);
		await closePdfImport(db, storage, importId);
	});
});

test("doesn't approve a review submitted before the draft's PDF attached, which would publish it without the PDF", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { files, importId, keyOf } = await importToSend(db, storage, ["dated.pdf"]);
		const itemKey = keyOf(files[0]!.rowId);
		await submitItemReview(db, itemKey, SEND.actor, fullConfig);
		await runPdfImportCycle(db, storage, fullConfig);
		await runPdfImportCycle(db, storage, fullConfig);

		const status = (await pdfImportStatus(db)).import!;
		expect(status.attach).toEqual({ [files[0]!.rowId]: "attached" });
		expect(status.sending).toEqual({ [files[0]!.rowId]: { message: expect.any(String), state: "held" } });
		expect(await db.select({ key: item.key }).from(item).where(eq(item.key, itemKey))).toEqual([]);
		expect(await db.select({ state: itemReview.state }).from(itemReview).where(eq(itemReview.itemKey, itemKey))).toEqual([{ state: "pending" }]);
		await closePdfImport(db, storage, importId);
	});
});

test("doesn't approve a review someone else submitted after the PDF attached under the importing editor's name", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { files, importId, keyOf } = await importToSend(db, storage, ["dated.pdf"]);
		const itemKey = keyOf(files[0]!.rowId);
		// The PDF attaches; before the send goes, a creator submits the draft with the same route.
		await db.update(pdfImportFile).set({ sendState: null }).where(eq(pdfImportFile.importId, importId));
		await runPdfImportCycle(db, storage, fullConfig);
		await setItemPublishingChoice(db, itemKey, routeChoice(SEND.route), fullConfig);
		await submitItemReview(db, itemKey, { role: "creator", userId: "user_creator" }, fullConfig);
		await db.update(pdfImportFile).set({ nextAttemptAt: new Date(), sendState: "waiting" }).where(eq(pdfImportFile.importId, importId));
		await runPdfImportCycle(db, storage, fullConfig);

		const status = (await pdfImportStatus(db)).import!;
		expect(status.sending).toEqual({ [files[0]!.rowId]: { message: expect.any(String), state: "held" } });
		// The status gives the route that review was submitted on.
		expect(status.reviews).toEqual({ [files[0]!.rowId]: expect.objectContaining({ route: "zenodo" }) });
		expect(await db.select({ key: item.key }).from(item).where(eq(item.key, itemKey))).toEqual([]);
		expect(await db.select({ state: itemReview.state, submittedBy: itemReview.submittedBy }).from(itemReview).where(eq(itemReview.itemKey, itemKey))).toEqual([{ state: "pending", submittedBy: "user_creator" }]);
	});
});

test("ends a draft's send when its PDF won't attach, so the import doesn't wait on it", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { importId } = await importToSend(db, storage, ["dated.pdf"]);
		// Storage refuses the attachment's copy on the last try.
		await db.update(pdfImportFile).set({ attempts: 2 }).where(eq(pdfImportFile.importId, importId));
		vi.spyOn(storage, "uploadPrivate").mockRejectedValue(new Error("Storage is down"));
		await runPdfImportCycle(db, storage, fullConfig);

		const status = (await pdfImportStatus(db)).import!;
		expect(Object.values(status.attach)).toEqual(["failed"]);
		expect(Object.values(status.sending)).toEqual([{ message: expect.any(String), state: "failed" }]);
		await closePdfImport(db, storage, importId);
	});
});
