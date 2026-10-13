import "server-only";

import { randomUUID } from "node:crypto";

import { canonicalZoteroFieldName } from "@opendeved/evidence-library-core/zotero-schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db";
import { pdfImport, pdfImportFile } from "@/db/schema/pdf-import";
import { canonicalItemFieldToDatabaseField } from "@/lib/item-field-codec";

import type { EvidenceFileStorage } from "./file-storage";
import type { PdfReading } from "./item-import-contract";
import { previewEntries } from "./item-import-service";
import { readImportPdf } from "./pdf-import";
import { readPdfProperties } from "./pdf-properties";

// The worker's side of the PDF import, kept apart from importing and
// attaching so the worker bundle needs nothing that renders PDFs.

// The worker gives up on a PDF after this many failed reads.
const MAX_ATTEMPTS = 3;
// PDFs the worker reads at once, and how long a read may hold its lease.
const READ_AT_ONCE = 8;
const LEASE = "10 minutes";
// A record can't be imported without these, so a read never leaves them out.
const NEEDED_FIELDS = new Set(["creators", "itemType", "title"]);

type FileRow = typeof pdfImportFile.$inferSelect;

/**
 * The reading as an import row. A field the AI got wrong, such as a web
 * address without https://, would hold back the whole record, so it is left
 * out and the record checked again; the editor can add it to the draft.
 */
async function previewReading(db: Database, source: string, zoteroItem: Record<string, unknown>) {
	const [first] = (await previewEntries(db, [{ method: "pdf", source, zoteroItem }])).records;
	const wrong = Object.keys(first!.fields ?? {}).filter((field) => field in zoteroItem && !NEEDED_FIELDS.has(field));
	if (!wrong.length) return first!;
	const kept = Object.fromEntries(Object.entries(zoteroItem).filter(([field]) => !wrong.includes(field)));
	return (await previewEntries(db, [{ method: "pdf", source, zoteroItem: kept }])).records[0]!;
}

/** The record's own name for a field the AI named as Zotero does: a report's institution is its publisher, a language its languageName. */
const recordField = (itemType: unknown, field: string) => canonicalItemFieldToDatabaseField(canonicalZoteroFieldName(String(itemType), field) ?? field);

async function readOne(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, file: FileRow, signal: AbortSignal | undefined): Promise<PdfReading> {
	const [owner] = await db.select().from(pdfImport).where(eq(pdfImport.id, file.importId));
	const bytes = await storage.downloadPrivate(file.objectPath!);
	const pdf = await readPdfProperties(bytes);
	const ai = await readImportPdf({ config, database: db, signal }, { bytes, checks: owner!.checks, filename: file.filename, instructions: owner!.instructions, pdf });
	const record = await previewReading(db, file.filename, ai.zoteroItem);
	// Suggestions use the record's field names, so applying one replaces the field the review shows.
	const suggestions = ai.suggestions.map((suggestion) => ({ ...suggestion, field: recordField(ai.zoteroItem.itemType, suggestion.field) }));
	return { checks: ai.checks, cites: ai.cites, collections: ai.collections, pdf, record: { ...record, id: String(file.position) }, suggestions, topics: ai.topics };
}

/**
 * The publication worker's PDF import cycle: claims a few uploaded PDFs with
 * a lease, as the association queues do, reads each with the library's AI,
 * and keeps the reading. A failed read is retried a few times, then shown
 * as failed with its error.
 */
/**
 * Removes the stored PDFs of closed imports. Closing tries at once; the
 * worker's cycle retries what a storage failure left behind.
 */
export async function removeClosedImportFiles(db: Database, storage: EvidenceFileStorage, importId?: string) {
	const files = await db
		.select({ id: pdfImportFile.id, objectPath: pdfImportFile.objectPath })
		.from(pdfImportFile)
		.innerJoin(pdfImport, eq(pdfImport.id, pdfImportFile.importId))
		.where(and(isNotNull(pdfImport.closedAt), isNotNull(pdfImportFile.objectPath), importId ? eq(pdfImport.id, importId) : undefined))
		.limit(100);
	if (!files.length) return;
	await storage.removePrivate(files.map(({ objectPath }) => objectPath!));
	await db.update(pdfImportFile).set({ objectPath: null }).where(inArray(pdfImportFile.id, files.map(({ id }) => id)));
}

/** Claims the next PDF waiting to be read, with a lease, as the association queues do. */
async function claimNext(db: Database) {
	const token = randomUUID();
	const claimed = await db.execute<{ id: string }>(sql`
		UPDATE "pdfImportFile" SET "leaseToken" = ${token}, "leaseExpiresAt" = now() + ${LEASE}::interval
		WHERE "id" = (SELECT "id" FROM "pdfImportFile"
			WHERE "nextAttemptAt" <= now() AND "objectPath" IS NOT NULL AND "reading" IS NULL
				AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
				AND "importId" IN (SELECT "id" FROM "pdfImport" WHERE "closedAt" IS NULL)
			ORDER BY "nextAttemptAt", "position" FOR UPDATE SKIP LOCKED LIMIT 1)
		RETURNING "id"`);
	const id = claimed.rows[0]?.id;
	if (!id) return null;
	const [file] = await db.select().from(pdfImportFile).where(eq(pdfImportFile.id, id));
	return file ? { file, token } : null;
}

async function readClaimed(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, file: FileRow, token: string, signal: AbortSignal | undefined) {
	const mine = and(eq(pdfImportFile.id, file.id), eq(pdfImportFile.leaseToken, token));
	try {
		const reading = await readOne(db, storage, config, file, signal);
		await db.update(pdfImportFile).set({ lastError: null, leaseExpiresAt: null, leaseToken: null, nextAttemptAt: null, reading }).where(mine);
	} catch (error) {
		// A worker asked to stop hands the PDF back for the next one, without counting a failed read.
		if (signal?.aborted) {
			await db.update(pdfImportFile).set({ leaseExpiresAt: null, leaseToken: null }).where(mine);
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		const attempts = file.attempts + 1;
		console.error("Reading an imported PDF failed", { attempts, error: message, file: file.filename, id: file.id });
		await db
			.update(pdfImportFile)
			.set({ attempts, lastError: message.slice(0, 2000), leaseExpiresAt: null, leaseToken: null, nextAttemptAt: attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + 10_000 * 2 ** attempts) })
			.where(mine);
	}
}

/**
 * The publication worker's PDF import cycle: a few readers each take the
 * next PDF waiting as soon as they finish one, until none waits, so a slow
 * PDF holds up only its own reader. A failed read is retried a few times,
 * then shown as failed with its error.
 */
export async function runPdfImportCycle(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, signal?: AbortSignal) {
	await removeClosedImportFiles(db, storage).catch((error: unknown) => console.error("Removing closed imports' PDFs failed", error));
	let read = false;
	await Promise.all(
		Array.from({ length: READ_AT_ONCE }, async () => {
			for (let next = await claimNext(db); next && !signal?.aborted; next = await claimNext(db)) {
				read = true;
				await readClaimed(db, storage, config, next.file, next.token, signal);
			}
		}),
	);
	return read;
}
