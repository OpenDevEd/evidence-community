import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";

import type { Database } from "@/db";
import { pdfImport, pdfImportFile } from "@/db/schema/pdf-import";

import { AdminValidationError } from "./errors";
import type { EvidenceFileStorage } from "./file-storage";
import type { AdminImportCommitRequest, AdminPdfImport, AdminPdfImportFile, AdminPdfImportStatus } from "./item-import-contract";
import { commitImportRecords } from "./item-import-service";
import { completeNativePdfUpload, stageNativePdfUpload } from "./native-file-service";
import { createNativeItemDraft } from "./native-item-service";
import { assertPdfHeader } from "./pdf-processing";

const PDF = "application/pdf";

type FileRow = typeof pdfImportFile.$inferSelect;

function fileState(file: FileRow, now: Date): AdminPdfImportFile["state"] {
	if (!file.objectPath) return "uploading";
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
			const state = fileState(file, now);
			return { filename: file.filename, id: file.id, message: state === "failed" ? file.lastError : null, reading: file.reading, rowId: String(file.position), state };
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
	await db.update(pdfImportFile).set({ nextAttemptAt: new Date(), objectPath }).where(eq(pdfImportFile.id, fileId));
}

/** An import's PDF, for its cover and for opening it in the review. */
export async function readPdfImportFile(db: Database, storage: EvidenceFileStorage, fileId: string) {
	const [file] = await db.select().from(pdfImportFile).where(and(eq(pdfImportFile.id, fileId), isNotNull(pdfImportFile.objectPath)));
	if (!file?.objectPath) throw new AdminValidationError("This PDF is not uploaded.");
	return { bytes: await storage.downloadPrivate(file.objectPath), filename: file.filename };
}

/** Ends the import, kept or discarded, and removes its stored PDFs; imported drafts keep their own copies. */
export async function closePdfImport(db: Database, storage: EvidenceFileStorage, importId: string) {
	const [closed] = await db.update(pdfImport).set({ closedAt: new Date() }).where(and(eq(pdfImport.id, importId), isNull(pdfImport.closedAt))).returning({ id: pdfImport.id });
	if (!closed) return;
	const files = await db.select({ objectPath: pdfImportFile.objectPath }).from(pdfImportFile).where(eq(pdfImportFile.importId, importId));
	const paths = files.flatMap(({ objectPath }) => (objectPath ? [objectPath] : []));
	if (paths.length) await storage.removePrivate(paths).catch((error: unknown) => console.error("Removing an import's stored PDFs failed", importId, error));
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

/** Imports the chosen records as drafts, gives each its PDF, and keeps what happened on the import. */
export async function commitPdfImport(
	db: Database,
	storage: EvidenceFileStorage,
	maxPdfBytes: number,
	input: Omit<AdminImportCommitRequest, "action">,
) {
	const { results } = await commitImportRecords(db, { ...input, action: "commit" });
	const files = await db.select().from(pdfImportFile).where(eq(pdfImportFile.importId, input.importId));
	const fileByRow = new Map(files.map((file) => [String(file.position), file]));
	const attach: Record<string, "attached" | "failed"> = {};
	for (const result of results) {
		const file = fileByRow.get(result.id);
		if (result.outcome !== "created" || !result.itemKey || !file?.objectPath) continue;
		try {
			await attachPdf(db, storage, maxPdfBytes, result.itemKey, file);
			attach[result.id] = "attached";
		} catch (error) {
			console.error("Attaching an imported PDF failed", { file: file.filename, itemKey: result.itemKey, error });
			attach[result.id] = "failed";
		}
	}
	await db.update(pdfImport).set({ attach, results }).where(eq(pdfImport.id, input.importId));
	return { attach, results };
}
