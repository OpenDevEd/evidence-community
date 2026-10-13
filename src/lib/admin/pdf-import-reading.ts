import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db";
import { pdfImport, pdfImportFile } from "@/db/schema/pdf-import";

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
const READ_AT_ONCE = 4;
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

async function readOne(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, file: FileRow): Promise<PdfReading> {
	const [owner] = await db.select().from(pdfImport).where(eq(pdfImport.id, file.importId));
	const bytes = await storage.downloadPrivate(file.objectPath!);
	const pdf = await readPdfProperties(bytes);
	const ai = await readImportPdf({ config, database: db }, { bytes, checks: owner!.checks, filename: file.filename, instructions: owner!.instructions, pdf });
	const record = await previewReading(db, file.filename, ai.zoteroItem);
	return { checks: ai.checks, pdf, record: { ...record, id: String(file.position) }, suggestions: ai.suggestions, topics: ai.topics };
}

/**
 * The publication worker's PDF import cycle: claims a few uploaded PDFs with
 * a lease, as the association queues do, reads each with the library's AI,
 * and keeps the reading. A failed read is retried a few times, then shown
 * as failed with its error.
 */
export async function runPdfImportCycle(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig) {
	const token = randomUUID();
	const claimed = await db.execute<{ id: string }>(sql`
		UPDATE "pdfImportFile" SET "leaseToken" = ${token}, "leaseExpiresAt" = now() + ${LEASE}::interval
		WHERE "id" IN (SELECT "id" FROM "pdfImportFile"
			WHERE "nextAttemptAt" <= now() AND "objectPath" IS NOT NULL AND "reading" IS NULL
				AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
			ORDER BY "nextAttemptAt", "position" FOR UPDATE SKIP LOCKED LIMIT ${READ_AT_ONCE})
		RETURNING "id"`);
	if (!claimed.rows.length) return false;
	const files = await db.select().from(pdfImportFile).where(and(eq(pdfImportFile.leaseToken, token)));
	await Promise.all(
		files.map(async (file) => {
			const mine = and(eq(pdfImportFile.id, file.id), eq(pdfImportFile.leaseToken, token));
			try {
				const reading = await readOne(db, storage, config, file);
				await db.update(pdfImportFile).set({ lastError: null, leaseExpiresAt: null, leaseToken: null, nextAttemptAt: null, reading }).where(mine);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const attempts = file.attempts + 1;
				console.error("Reading an imported PDF failed", { attempts, error: message, file: file.filename, id: file.id });
				await db
					.update(pdfImportFile)
					.set({ attempts, lastError: message.slice(0, 2000), leaseExpiresAt: null, leaseToken: null, nextAttemptAt: attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + 10_000 * 2 ** attempts) })
					.where(mine);
			}
		}),
	);
	return true;
}
