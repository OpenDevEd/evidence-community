import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";

import type { Database } from "@/db";
import { pdfImport, pdfImportFile } from "@/db/schema/pdf-import";

import { AdminValidationError } from "./errors";
import type { EvidenceFileStorage } from "./file-storage";
import type { AdminImportCommitRequest, AdminImportCommitResult, AdminPdfImport, AdminPdfImportFile, AdminPdfImportStatus, PdfReading } from "./item-import-contract";
import { commitImportRecords } from "./item-import-service";
import { completeNativePdfUpload, stageNativePdfUpload } from "./native-file-service";
import { createNativeItemDraft } from "./native-item-service";
import { importObjectPath, removeImportFiles } from "./pdf-import-reading";

const PDF = "application/pdf";

// A PDF that hasn't arrived this long after its import started never will: its tab closed or lost the connection.
const UPLOAD_WAIT_MS = 15 * 60_000;
// How long one request may hold the import while it imports the records.
const COMMIT_WAIT_MS = 10 * 60_000;
const NOT_UPLOADED = "The PDF didn't finish uploading.";

type FileRow = typeof pdfImportFile.$inferSelect;

function fileState(file: FileRow, startedAt: Date, now: Date): AdminPdfImportFile["state"] {
	if (!file.objectPath) return file.lastError || now.getTime() - startedAt.getTime() > UPLOAD_WAIT_MS ? "failed" : "uploading";
	if (file.reading) return "read";
	if (!file.nextAttemptAt) return "failed";
	return file.leaseExpiresAt && file.leaseExpiresAt > now ? "reading" : "waiting";
}

/** The PDFs that are the same file as one earlier in the import, which can't be imported twice. */
function repeatedFiles(files: FileRow[]) {
	const seen = new Set<string>();
	const repeats = new Set<string>();
	for (const { id, reading } of files) {
		if (!reading) continue;
		if (seen.has(reading.sha256)) repeats.add(id);
		seen.add(reading.sha256);
	}
	return repeats;
}

// A ready record of a repeated PDF repeats the earlier one; one already found in the library stays found.
const asRepeat = (reading: PdfReading): PdfReading => (reading.record.state === "ready" ? { ...reading, record: { ...reading.record, state: "repeated" } } : reading);

/** What attaching did for each imported draft, by its row: attached, or failed for good. */
const attachOutcomes = (files: FileRow[]) =>
	Object.fromEntries(files.flatMap(({ attachState, position }) => (attachState === "attached" || attachState === "failed" ? [[String(position), attachState]] : [])));

/** The library's open import with where each PDF has got to, and the checks and instructions a new one starts from. */
export async function pdfImportStatus(db: Database): Promise<AdminPdfImportStatus> {
	const [open] = await db.select().from(pdfImport).where(isNull(pdfImport.closedAt)).limit(1);
	const [last] = open ? [open] : await db.select().from(pdfImport).orderBy(desc(pdfImport.createdAt)).limit(1);
	const lastUsed = { checks: last?.checks ?? [], instructions: last?.instructions ?? "" };
	if (!open) return { import: null, last: lastUsed };
	const files = await db.select().from(pdfImportFile).where(eq(pdfImportFile.importId, open.id)).orderBy(asc(pdfImportFile.position));
	const now = new Date();
	const repeats = repeatedFiles(files);
	const view: AdminPdfImport = {
		attach: attachOutcomes(files),
		checks: open.checks,
		collections: open.collections,
		createdAt: open.createdAt.toISOString(),
		files: files.map((file) => {
			const state = fileState(file, open.createdAt, now);
			const reading = repeats.has(file.id) ? asRepeat(file.reading!) : file.reading;
			return { filename: file.filename, id: file.id, message: state === "failed" ? (file.lastError ?? NOT_UPLOADED) : null, reading, rowId: String(file.position), state, stored: Boolean(file.objectPath) };
		}),
		id: open.id,
		instructions: open.instructions,
		results: open.results,
	};
	return { import: view, last: lastUsed };
}

/**
 * Opens the library's import with a row for each PDF the editor chose, and
 * a signed upload for each: the PDFs go straight to private storage, as an
 * attachment's PDF does, because a request through the app is cut off at
 * 10 MB. They're read as they arrive.
 */
export async function startPdfImport(db: Database, storage: EvidenceFileStorage, maxPdfBytes: number, input: { checks: string[]; collections: string[]; createdBy: string; files: { name: string; size: number }[]; instructions: string }) {
	const oversized = input.files.find(({ size }) => size > maxPdfBytes);
	if (oversized) throw new AdminValidationError(`${oversized.name} is larger than the library takes (${Math.floor(maxPdfBytes / 1024 / 1024)} MB).`);
	const started = await db.transaction(async (transaction) => {
		const [open] = await transaction.select({ id: pdfImport.id }).from(pdfImport).where(isNull(pdfImport.closedAt)).limit(1);
		if (open) throw new AdminValidationError("Another import is open. Finish or discard it first.");
		const [created] = await transaction
			.insert(pdfImport)
			.values({ checks: input.checks, collections: input.collections, createdBy: input.createdBy, instructions: input.instructions })
			.returning({ id: pdfImport.id });
		const files = await transaction
			.insert(pdfImportFile)
			.values(input.files.map(({ name }, index) => ({ filename: name, importId: created!.id, position: index + 1 })))
			.returning({ filename: pdfImportFile.filename, id: pdfImportFile.id });
		return { files, id: created!.id };
	});
	try {
		const files = await Promise.all(started.files.map(async (file) => ({ ...file, upload: await storage.createSignedUpload(importObjectPath(started.id, file.id)) })));
		return { files, id: started.id };
	} catch (error) {
		// An import whose PDFs can't be sent would only stand in the way of the next one.
		await closePdfImport(db, storage, started.id);
		throw error;
	}
}

/** Queues a PDF the editor's tab sent to storage, while its import is open; one discarded meanwhile loses it. */
export async function confirmPdfImportUpload(db: Database, storage: EvidenceFileStorage, fileId: string) {
	const [file] = await db.select({ importId: pdfImportFile.importId }).from(pdfImportFile).where(and(eq(pdfImportFile.id, fileId), isNull(pdfImportFile.objectPath)));
	if (!file) throw new AdminValidationError("This PDF is not waiting for an upload.");
	const objectPath = importObjectPath(file.importId, fileId);
	const [stored] = await db
		.update(pdfImportFile)
		.set({ nextAttemptAt: new Date(), objectPath })
		.where(and(eq(pdfImportFile.id, fileId), isNull(pdfImportFile.objectPath), inArray(pdfImportFile.importId, db.select({ id: pdfImport.id }).from(pdfImport).where(isNull(pdfImport.closedAt)))))
		.returning({ id: pdfImportFile.id });
	if (!stored) {
		await storage.removePrivate([objectPath]);
		throw new AdminValidationError("The import was closed while this PDF uploaded.");
	}
}

/** Marks a PDF the editor's tab couldn't send, so the import can go ahead without it. */
export async function failPdfImportUpload(db: Database, fileId: string, message: string) {
	await db.update(pdfImportFile).set({ lastError: message.slice(0, 500) || NOT_UPLOADED }).where(and(eq(pdfImportFile.id, fileId), isNull(pdfImportFile.objectPath)));
}

/** An import's PDF, for its cover and for opening it in the review. */
export async function readPdfImportFile(db: Database, storage: EvidenceFileStorage, fileId: string) {
	const [file] = await db.select().from(pdfImportFile).where(and(eq(pdfImportFile.id, fileId), isNotNull(pdfImportFile.objectPath)));
	if (!file?.objectPath) throw new AdminValidationError("This PDF is not uploaded.");
	return { bytes: await storage.downloadPrivate(file.objectPath), filename: file.filename };
}

/**
 * Ends the import, kept or discarded, and removes its stored PDFs; imported
 * drafts keep their own copies. It waits while the worker still gives drafts
 * their PDFs, which it reads from those stored copies.
 */
export async function closePdfImport(db: Database, storage: EvidenceFileStorage, importId: string) {
	const [attaching] = await db.select({ id: pdfImportFile.id }).from(pdfImportFile).where(and(eq(pdfImportFile.importId, importId), eq(pdfImportFile.attachState, "waiting"))).limit(1);
	if (attaching) throw new AdminValidationError("The drafts are still getting their PDFs. Close the import once they have them.");
	await db.update(pdfImport).set({ closedAt: new Date() }).where(and(eq(pdfImport.id, importId), isNull(pdfImport.closedAt)));
	// The worker removes them again once their upload links have stopped working, and so retries what a storage failure leaves.
	await removeImportFiles(db, storage, importId).catch((error: unknown) => console.error("Removing an import's stored PDFs failed", importId, error));
}

/**
 * Makes the drafts, keeps their results on the import and queues each
 * draft's PDF for the worker, in one transaction, so a retry never makes
 * them twice and no draft is left waiting for a PDF nobody queued.
 */
async function createDrafts(db: Database, input: Omit<AdminImportCommitRequest, "action">) {
	return db.transaction(async (transaction) => {
		const { results } = await commitImportRecords(transaction, { ...input, action: "commit" });
		await transaction.update(pdfImport).set({ results }).where(eq(pdfImport.id, input.importId));
		for (const { id, itemKey, outcome } of results) {
			if (outcome !== "created" || !itemKey) continue;
			await transaction
				.update(pdfImportFile)
				.set({ attachState: "waiting", attachTo: itemKey, attempts: 0, nextAttemptAt: new Date() })
				.where(and(eq(pdfImportFile.importId, input.importId), eq(pdfImportFile.position, Number(id)), isNotNull(pdfImportFile.objectPath)));
		}
		return results;
	});
}

/**
 * Imports the chosen records as drafts, and the worker then gives each its
 * PDF. One request holds the import while it does, so a second tab or a
 * retry can't import the records twice; one that comes after them gets the
 * records already made.
 */
export async function commitPdfImport(db: Database, input: Omit<AdminImportCommitRequest, "action">) {
	const [claimed] = await db
		.update(pdfImport)
		.set({ commitStartedAt: new Date() })
		.where(and(eq(pdfImport.id, input.importId), isNull(pdfImport.closedAt), isNull(pdfImport.results), or(isNull(pdfImport.commitStartedAt), lt(pdfImport.commitStartedAt, new Date(Date.now() - COMMIT_WAIT_MS)))))
		.returning({ id: pdfImport.id });
	if (!claimed) {
		const [current] = await db.select().from(pdfImport).where(eq(pdfImport.id, input.importId));
		if (!current?.results) throw new AdminValidationError("These records are already being imported. Wait a moment, then open the import again.");
		return { results: current.results };
	}
	try {
		return { results: await createDrafts(db, input) };
	} catch (error) {
		await db.update(pdfImport).set({ commitStartedAt: null }).where(eq(pdfImport.id, input.importId));
		throw error;
	}
}
