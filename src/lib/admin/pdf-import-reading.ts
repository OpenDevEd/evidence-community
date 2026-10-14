import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { itemFileDraft } from "@opendeved/evidence-library-core";
import { canonicalZoteroFieldName, getZoteroItemType } from "@opendeved/evidence-library-core/zotero-schema";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db";
import { pdfImport, pdfImportFile } from "@/db/schema/pdf-import";
import { itemFilePublication } from "@/db/schema/source";
import { canonicalItemFieldToDatabaseField, primaryCreatorType } from "@/lib/item-field-codec";

import type { EvidenceFileStorage } from "./file-storage";
import type { PdfReading } from "./item-import-contract";
import { previewEntries } from "./item-import-service";
import { readImportPdf } from "./pdf-import";
import { readPdfProperties } from "./pdf-properties";
import { languageTag } from "./pdf-record-mapping";

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

/** A language as the ISO 639 code publishing needs, from the name or tag the PDF gives ("English", "en-GB"); "" when it isn't one. */
const languageCode = (value: unknown) => languageTag(typeof value === "string" ? value.trim() : "").split("-")[0]!;

/**
 * The AI's record in the forms the library keeps: its language as a code,
 * and each creator in a role its type has, the type's own (author, a
 * film's director) for any other. A record in another form can't be
 * imported or published as it is.
 */
function inLibraryForms(zoteroItem: Record<string, unknown>) {
	const itemType = String(zoteroItem.itemType);
	const roles = new Set(getZoteroItemType(itemType)?.creatorTypes.map(({ creatorType }) => creatorType));
	const creators = (Array.isArray(zoteroItem.creators) ? zoteroItem.creators : []).map((creator: Record<string, unknown>) => (roles.has(String(creator.creatorType)) ? creator : { ...creator, creatorType: primaryCreatorType(itemType) }));
	const { language, ...rest } = zoteroItem;
	const code = languageCode(language);
	return { ...rest, creators, ...(code ? { language: code } : {}) };
}

/** The record in the library whose PDF is this very file, as a draft's upload or a published copy. */
async function recordWithFile(db: Database, sha256: string) {
	const [draft] = await db.select({ key: itemFileDraft.parentItemKey }).from(itemFileDraft).where(eq(itemFileDraft.actualSha256, sha256)).limit(1);
	if (draft) return draft.key;
	const [published] = await db.select({ key: itemFilePublication.parentItemKey }).from(itemFilePublication).where(eq(itemFilePublication.sha256, sha256)).limit(1);
	return published?.key;
}

/** The record's own name for a field the AI named as Zotero does: a report's institution is its publisher, a language its languageName. */
const recordField = (itemType: unknown, field: string) => canonicalItemFieldToDatabaseField(canonicalZoteroFieldName(String(itemType), field) ?? field);

async function readOne(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, file: FileRow, signal: AbortSignal | undefined): Promise<PdfReading> {
	const [owner] = await db.select().from(pdfImport).where(eq(pdfImport.id, file.importId));
	const bytes = await storage.downloadPrivate(file.objectPath!);
	const pdf = await readPdfProperties(bytes);
	// The editor who started the import is who OpenScholar's author search answers.
	const ai = await readImportPdf({ clerkUserId: owner!.createdBy, config, database: db, signal }, { bytes, checks: owner!.checks, filename: file.filename, instructions: owner!.instructions, pdf });
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const read = await previewReading(db, file.filename, inLibraryForms(ai.zoteroItem));
	// The same file already in the library is that record, whether or not its DOI says so.
	const existingKey = read.state === "ready" ? await recordWithFile(db, sha256) : undefined;
	const record = { ...read, id: String(file.position), ...(existingKey ? { existingKey, state: "existing" as const } : {}) };
	// Suggestions use the record's field names, so applying one replaces the field the review shows; one that changes nothing is dropped.
	const suggestions = ai.suggestions.map((suggestion) => ({ ...suggestion, field: recordField(ai.zoteroItem.itemType, suggestion.field) })).filter(({ field, value }) => record.payload?.[field] !== value);
	return { checks: ai.checks, cites: ai.cites, collections: ai.collections, pdf, record, sha256, suggestions, topics: ai.topics };
}

/** Where an import's PDF is stored while the import is open. */
export const importObjectPath = (importId: string, fileId: string) => `imports/${importId}/${fileId}.pdf`;

/**
 * Removes the stored PDFs of closed imports, one import of the library at a time
 * or the one named: every path an import handed out, so a PDF whose upload
 * finished after its tab stopped listening goes too.
 */
export async function removeClosedImportFiles(db: Database, storage: EvidenceFileStorage, importId?: string) {
	const closed = await db
		.select({ id: pdfImport.id })
		.from(pdfImport)
		.where(and(isNotNull(pdfImport.closedAt), isNull(pdfImport.filesRemovedAt), importId ? eq(pdfImport.id, importId) : undefined))
		.limit(10);
	for (const { id } of closed) {
		const files = await db.select({ id: pdfImportFile.id }).from(pdfImportFile).where(eq(pdfImportFile.importId, id));
		if (files.length) await storage.removePrivate(files.map((file) => importObjectPath(id, file.id)));
		await db.update(pdfImport).set({ filesRemovedAt: new Date() }).where(eq(pdfImport.id, id));
	}
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
