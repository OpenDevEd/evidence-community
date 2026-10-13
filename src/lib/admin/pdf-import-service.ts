import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";

import type { Database } from "@/db";
import { pdfImport, pdfImportFile } from "@/db/schema/pdf-import";

import { AdminValidationError } from "./errors";
import type { EvidenceFileStorage } from "./file-storage";
import type { AdminImportCommitRequest, AdminImportCommitResult, AdminPdfImport, AdminPdfImportFile, AdminPdfImportStatus } from "./item-import-contract";
import { commitImportRecords } from "./item-import-service";
import { completeNativePdfUpload, stageNativePdfUpload } from "./native-file-service";
import { createNativeItemDraft } from "./native-item-service";
import { removeClosedImportFiles } from "./pdf-import-reading";
import { assertPdfHeader } from "./pdf-processing";

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

/** The library's open import with where each PDF has got to, and the checks and instructions a new one starts from. */
export async function pdfImportStatus(db: Database): Promise<AdminPdfImportStatus> {
	const [open] = await db.select().from(pdfImport).where(isNull(pdfImport.closedAt)).limit(1);
	const [last] = open ? [open] : await db.select().from(pdfImport).orderBy(desc(pdfImport.createdAt)).limit(1);
	const lastUsed = { checks: last?.checks ?? [], instructions: last?.instructions ?? "" };
	if (!open) return { import: null, last: lastUsed };
	const files = await db.select().from(pdfImportFile).where(eq(pdfImportFile.importId, open.id)).orderBy(asc(pdfImportFile.position));
	const now = new Date();
	const view: AdminPdfImport = {
		attach: open.attach,
		checks: open.checks,
		collections: open.collections,
		createdAt: open.createdAt.toISOString(),
		files: files.map((file) => {
			const state = fileState(file, open.createdAt, now);
			return { filename: file.filename, id: file.id, message: state === "failed" ? (file.lastError ?? NOT_UPLOADED) : null, reading: file.reading, rowId: String(file.position), state, stored: Boolean(file.objectPath) };
		}),
		id: open.id,
		instructions: open.instructions,
		results: open.results,
	};
	return { import: view, last: lastUsed };
}

/** Opens the library's import with a row for each PDF the editor chose; they're read as they arrive. */
export async function startPdfImport(db: Database, input: { checks: string[]; collections: string[]; createdBy: string; filenames: string[]; instructions: string }) {
	return db.transaction(async (transaction) => {
		const [open] = await transaction.select({ id: pdfImport.id }).from(pdfImport).where(isNull(pdfImport.closedAt)).limit(1);
		if (open) throw new AdminValidationError("Another import is open. Finish or discard it first.");
		const [created] = await transaction
			.insert(pdfImport)
			.values({ checks: input.checks, collections: input.collections, createdBy: input.createdBy, instructions: input.instructions })
			.returning({ id: pdfImport.id });
		const files = await transaction
			.insert(pdfImportFile)
			.values(input.filenames.map((filename, index) => ({ filename, importId: created!.id, position: index + 1 })))
			.returning({ filename: pdfImportFile.filename, id: pdfImportFile.id });
		return { files, id: created!.id };
	});
}

/** Keeps one uploaded PDF in private storage and queues it for the worker. */
export async function storePdfImportFile(db: Database, storage: EvidenceFileStorage, fileId: string, bytes: Uint8Array) {
	assertPdfHeader(bytes);
	const [file] = await db
		.select({ importId: pdfImportFile.importId })
		.from(pdfImportFile)
		.innerJoin(pdfImport, eq(pdfImport.id, pdfImportFile.importId))
		.where(and(eq(pdfImportFile.id, fileId), isNull(pdfImport.closedAt), isNull(pdfImportFile.objectPath)));
	if (!file) throw new AdminValidationError("This PDF is not waiting for an upload.");
	const objectPath = `imports/${file.importId}/${fileId}.pdf`;
	await storage.uploadPrivate(objectPath, bytes, PDF);
	// Only while the import is still open: one discarded during the upload has already collected its PDFs.
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

/** Ends the import, kept or discarded, and removes its stored PDFs; imported drafts keep their own copies. */
export async function closePdfImport(db: Database, storage: EvidenceFileStorage, importId: string) {
	await db.update(pdfImport).set({ closedAt: new Date() }).where(and(eq(pdfImport.id, importId), isNull(pdfImport.closedAt)));
	// The worker's cycle retries what a storage failure leaves behind.
	await removeClosedImportFiles(db, storage, importId).catch((error: unknown) => console.error("Removing an import's stored PDFs failed", importId, error));
}

/** Gives a draft its PDF from the import, through the same staging an upload in the inspector takes. */
async function attachPdf(db: Database, storage: EvidenceFileStorage, maxPdfBytes: number, parentItem: string, file: FileRow) {
	const bytes = await storage.downloadPrivate(file.objectPath!);
	const attachment = await createNativeItemDraft(db, { collections: [], itemType: "attachment", parentItem, tags: [], title: file.filename });
	const { itemKey } = attachment;
	const staged = await stageNativePdfUpload(db, storage, {
		expectedSha256: createHash("sha256").update(bytes).digest("hex"),
		expectedSizeBytes: bytes.byteLength,
		filename: file.filename,
		itemKey,
		maxPdfBytes,
	});
	await storage.uploadPrivate(staged.fileDraft.objectPath, bytes, PDF);
	await completeNativePdfUpload(db, storage, { expectedUploadRevision: staged.fileDraft.uploadRevision, itemKey, maxPdfBytes });
}

/**
 * Gives each new draft its PDF, keeping each outcome on the import as it
 * finishes, so a repeated request carries on from where one stopped.
 */
async function attachPdfs(db: Database, storage: EvidenceFileStorage, maxPdfBytes: number, importId: string, results: AdminImportCommitResult[], done: Record<string, "attached" | "failed">) {
	const files = await db.select().from(pdfImportFile).where(eq(pdfImportFile.importId, importId));
	const fileByRow = new Map(files.map((file) => [String(file.position), file]));
	const attach = { ...done };
	for (const result of results) {
		const file = fileByRow.get(result.id);
		// ponytail: a request that stopped inside one attachment leaves it unrecorded, and the next tries it again.
		if (result.outcome !== "created" || !result.itemKey || !file?.objectPath || attach[result.id]) continue;
		try {
			await attachPdf(db, storage, maxPdfBytes, result.itemKey, file);
			attach[result.id] = "attached";
		} catch (error) {
			console.error("Attaching an imported PDF failed", { file: file.filename, itemKey: result.itemKey, error });
			attach[result.id] = "failed";
		}
		await db.update(pdfImport).set({ attach }).where(eq(pdfImport.id, importId));
	}
	return { attach, results };
}

/**
 * Imports the chosen records as drafts and gives each its PDF. One request
 * holds the import while it does, so a second tab or a retry can't import
 * the records twice; a request after the records are in carries on
 * attaching their PDFs.
 */
export async function commitPdfImport(
	db: Database,
	storage: EvidenceFileStorage,
	maxPdfBytes: number,
	input: Omit<AdminImportCommitRequest, "action">,
) {
	const [claimed] = await db
		.update(pdfImport)
		.set({ commitStartedAt: new Date() })
		.where(and(eq(pdfImport.id, input.importId), isNull(pdfImport.closedAt), isNull(pdfImport.results), or(isNull(pdfImport.commitStartedAt), lt(pdfImport.commitStartedAt, new Date(Date.now() - COMMIT_WAIT_MS)))))
		.returning({ id: pdfImport.id });
	if (!claimed) {
		const [current] = await db.select().from(pdfImport).where(eq(pdfImport.id, input.importId));
		if (!current?.results) throw new AdminValidationError("These records are already being imported. Wait a moment, then open the import again.");
		return attachPdfs(db, storage, maxPdfBytes, current.id, current.results, current.attach);
	}
	let results: AdminImportCommitResult[];
	try {
		({ results } = await commitImportRecords(db, { ...input, action: "commit" }));
	} catch (error) {
		await db.update(pdfImport).set({ commitStartedAt: null }).where(eq(pdfImport.id, input.importId));
		throw error;
	}
	await db.update(pdfImport).set({ results }).where(eq(pdfImport.id, input.importId));
	return attachPdfs(db, storage, maxPdfBytes, input.importId, results, {});
}
