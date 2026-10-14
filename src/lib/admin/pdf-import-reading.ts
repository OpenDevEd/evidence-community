import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { itemDraft, itemFileDraft } from "@opendeved/evidence-library-core";
import { canonicalZoteroFieldName, getZoteroItemType } from "@opendeved/evidence-library-core/zotero-schema";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db";
import { pdfImport, pdfImportFile } from "@/db/schema/pdf-import";
import { itemFilePublication } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { canonicalItemFieldToDatabaseField, primaryCreatorType } from "@/lib/item-field-codec";

import type { EvidenceFileStorage } from "./file-storage";
import type { PdfReading } from "./item-import-contract";
import { previewEntries } from "./item-import-service";
import { completeNativePdfUpload, stageNativePdfUpload } from "./native-file-service";
import { createNativeItemDraft } from "./native-item-service";
import { readImportPdf } from "./pdf-import";
import { readPdfProperties } from "./pdf-properties";
import { languageTag } from "./pdf-record-mapping";

// The worker's side of the PDF import: it reads each uploaded PDF with the
// library's AI and, once the records are imported, gives each draft its PDF.

// The worker gives up on a PDF after this many failed reads, or failed attachments.
const MAX_ATTEMPTS = 3;
// PDFs the worker reads at once, and PDFs it attaches at once.
const READ_AT_ONCE = 8;
const ATTACH_AT_ONCE = 2;
// A read may take this long; its lease outlasts it, so no other reader takes the PDF meanwhile.
const READ_TIMEOUT_MS = 8 * 60_000;
const LEASE = "10 minutes";
// A signed upload link works this long, so a PDF can arrive this long after its tab asked for the link.
const UPLOAD_LINK_MS = 2 * 60 * 60_000;
// A record can't be imported without these, so a read never leaves them out.
const NEEDED_FIELDS = new Set(["creators", "itemType", "title"]);
const PDF = "application/pdf";

type FileRow = typeof pdfImportFile.$inferSelect;

/** A read that can't succeed, however often it is tried. */
class UnreadablePdfError extends Error {}

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

/** The record's own name for a field the AI named as Zotero does: a report's institution is its publisher, a language its languageName. */
const recordField = (itemType: unknown, field: string) => canonicalItemFieldToDatabaseField(canonicalZoteroFieldName(String(itemType), field) ?? field);

/** The library's record whose PDF is this very file, as a draft's upload or a published copy. */
async function fileOwner(db: Database, sha256: string) {
	const [draft] = await db.select({ key: itemFileDraft.parentItemKey }).from(itemFileDraft).where(eq(itemFileDraft.actualSha256, sha256)).limit(1);
	if (draft) return draft.key;
	const [published] = await db.select({ key: itemFilePublication.parentItemKey }).from(itemFilePublication).where(eq(itemFilePublication.sha256, sha256)).limit(1);
	return published?.key;
}

/** A record's title as published, or as its draft has it when it isn't published. */
async function recordTitle(db: Database, key: string) {
	const [record] = await db.select({ title: item.title }).from(item).where(eq(item.key, key));
	if (record) return record.title;
	const [draft] = await db.select({ patch: itemDraft.patch }).from(itemDraft).where(eq(itemDraft.itemKey, key));
	return (draft?.patch as { title?: string } | undefined)?.title || null;
}

/** The library's record whose PDF is this very file, with its title. */
async function recordWithFile(db: Database, sha256: string) {
	const key = await fileOwner(db, sha256);
	return key ? { key, title: await recordTitle(db, key) } : null;
}

/** Whether an earlier PDF of the same import is this very file. */
async function repeatsEarlier(db: Database, file: FileRow, sha256: string) {
	const [earlier] = await db
		.select({ id: pdfImportFile.id })
		.from(pdfImportFile)
		.where(and(eq(pdfImportFile.importId, file.importId), eq(pdfImportFile.sha256, sha256), lt(pdfImportFile.position, file.position)))
		.limit(1);
	return Boolean(earlier);
}

/**
 * The reading of a PDF that is the same file as a record in the library or
 * an earlier PDF of the import, made without asking the AI: it can't be
 * imported again, and reading it would only cost.
 */
function sameFileReading(file: FileRow, pdf: PdfReading["pdf"], sha256: string, existing: { key: string; title: string | null } | null): PdfReading {
	const record = { creators: [], id: String(file.position), itemType: null, method: "pdf" as const, payload: null, source: file.filename, title: existing?.title ?? null, year: null };
	return { checks: [], cites: [], collections: [], pdf, record: existing ? { ...record, existingKey: existing.key, state: "existing" } : { ...record, state: "repeated" }, sha256, suggestions: [], topics: [] };
}

async function readOne(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, file: FileRow, signal: AbortSignal | undefined): Promise<PdfReading> {
	const [owner] = await db.select().from(pdfImport).where(eq(pdfImport.id, file.importId));
	const bytes = await storage.downloadPrivate(file.objectPath!);
	const limit = config.services.storage.maxPdfBytes;
	if (bytes.byteLength > limit) throw new UnreadablePdfError(`This PDF is larger than the library takes (${Math.floor(limit / 1024 / 1024)} MB).`);
	// The file is known before the AI is asked, so a PDF the library or this import already has costs no read.
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	await db.update(pdfImportFile).set({ sha256 }).where(eq(pdfImportFile.id, file.id));
	const pdf = await readPdfProperties(bytes);
	const existing = await recordWithFile(db, sha256);
	if (existing || (await repeatsEarlier(db, file, sha256))) return sameFileReading(file, pdf, sha256, existing);
	// The editor who started the import is who OpenScholar's author search answers.
	const readSignal = AbortSignal.any([AbortSignal.timeout(READ_TIMEOUT_MS), ...(signal ? [signal] : [])]);
	const ai = await readImportPdf({ clerkUserId: owner!.createdBy, config, database: db, signal: readSignal }, { bytes, checks: owner!.checks, filename: file.filename, instructions: owner!.instructions, pdf });
	const read = await previewReading(db, file.filename, inLibraryForms(ai.zoteroItem));
	const record = { ...read, id: String(file.position) };
	// Suggestions use the record's field names, so applying one replaces the field the review shows; one that changes nothing is dropped.
	const suggestions = ai.suggestions.map((suggestion) => ({ ...suggestion, field: recordField(ai.zoteroItem.itemType, suggestion.field) })).filter(({ field, value }) => record.payload?.[field] !== value);
	return { checks: ai.checks, cites: ai.cites, collections: ai.collections, pdf, record, sha256, suggestions, topics: ai.topics };
}

/** Where an import's PDF is stored while the import is open. */
export const importObjectPath = (importId: string, fileId: string) => `imports/${importId}/${fileId}.pdf`;

/** Removes every path an import handed out, so a PDF whose upload finished after its tab stopped listening goes too. */
export async function removeImportFiles(db: Database, storage: EvidenceFileStorage, importId: string) {
	const files = await db.select({ id: pdfImportFile.id }).from(pdfImportFile).where(eq(pdfImportFile.importId, importId));
	if (files.length) await storage.removePrivate(files.map((file) => importObjectPath(importId, file.id)));
}

/**
 * Removes closed imports' PDFs once more after their upload links stopped
 * working, which catches a PDF that arrived after its import closed, then
 * marks them gone.
 */
async function removeLateImportFiles(db: Database, storage: EvidenceFileStorage) {
	const closed = await db
		.select({ id: pdfImport.id })
		.from(pdfImport)
		.where(and(isNotNull(pdfImport.closedAt), isNull(pdfImport.filesRemovedAt), lt(pdfImport.closedAt, new Date(Date.now() - UPLOAD_LINK_MS))))
		.limit(10);
	for (const { id } of closed) {
		await removeImportFiles(db, storage, id);
		await db.update(pdfImport).set({ filesRemovedAt: new Date() }).where(eq(pdfImport.id, id));
	}
}

/** Claims the next PDF waiting for the given work, with a lease, as the association queues do. */
async function claimNext(db: Database, waiting: ReturnType<typeof sql>) {
	const token = randomUUID();
	const claimed = await db.execute<{ id: string }>(sql`
		UPDATE "pdfImportFile" SET "leaseToken" = ${token}, "leaseExpiresAt" = now() + ${LEASE}::interval
		WHERE "id" = (SELECT "id" FROM "pdfImportFile"
			WHERE "nextAttemptAt" <= now() AND ${waiting}
				AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < now())
				AND "importId" IN (SELECT "id" FROM "pdfImport" WHERE "closedAt" IS NULL)
			ORDER BY "nextAttemptAt", "position" FOR UPDATE SKIP LOCKED LIMIT 1)
		RETURNING "id"`);
	const id = claimed.rows[0]?.id;
	if (!id) return null;
	const [file] = await db.select().from(pdfImportFile).where(eq(pdfImportFile.id, id));
	return file ? { file, token } : null;
}

const TO_READ = sql`"objectPath" IS NOT NULL AND "reading" IS NULL`;
const TO_ATTACH = sql`"attachState" = 'waiting'`;

/** When a failed read or attachment is tried again, and null once it has been tried enough. */
const retryAt = (attempts: number, permanent: boolean) => (permanent || attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + 10_000 * 2 ** attempts));

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
			.set({ attempts, lastError: message.slice(0, 2000), leaseExpiresAt: null, leaseToken: null, nextAttemptAt: retryAt(attempts, error instanceof UnreadablePdfError) })
			.where(mine);
	}
}

/** The draft's attachment for an imported PDF, made once and kept on the PDF's row, so a try that stopped part way carries on with it. */
async function attachmentFor(db: Database, file: FileRow) {
	if (file.attachmentKey) return file.attachmentKey;
	// ponytail: a worker that stops between these two writes leaves one empty attachment draft behind.
	const { itemKey } = await createNativeItemDraft(db, { collections: [], itemType: "attachment", parentItem: file.attachTo, tags: [], title: file.filename });
	await db.update(pdfImportFile).set({ attachmentKey: itemKey }).where(eq(pdfImportFile.id, file.id));
	return itemKey;
}

/** Gives a draft its PDF from the import, through the same staging an upload in the inspector takes. */
async function attachOne(db: Database, storage: EvidenceFileStorage, maxPdfBytes: number, file: FileRow) {
	const bytes = await storage.downloadPrivate(file.objectPath!);
	const itemKey = await attachmentFor(db, file);
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

async function attachClaimed(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, file: FileRow, token: string) {
	const mine = and(eq(pdfImportFile.id, file.id), eq(pdfImportFile.leaseToken, token));
	try {
		await attachOne(db, storage, config.services.storage.maxPdfBytes, file);
		await db.update(pdfImportFile).set({ attachState: "attached", lastError: null, leaseExpiresAt: null, leaseToken: null, nextAttemptAt: null }).where(mine);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const attempts = file.attempts + 1;
		const nextAttemptAt = retryAt(attempts, false);
		console.error("Attaching an imported PDF failed", { attempts, error: message, file: file.filename, itemKey: file.attachTo });
		await db
			.update(pdfImportFile)
			.set({ attachState: nextAttemptAt ? "waiting" : "failed", attempts, lastError: message.slice(0, 2000), leaseExpiresAt: null, leaseToken: null, nextAttemptAt })
			.where(mine);
	}
}

/** Runs `work` on each PDF claimed for it until none waits or the worker is asked to stop; true when it did any. */
async function drain(db: Database, waiting: ReturnType<typeof sql>, signal: AbortSignal | undefined, work: (file: FileRow, token: string) => Promise<void>) {
	let worked = false;
	// The stop is checked before each claim, so a stopping worker leaves the next PDF unclaimed.
	for (let next = signal?.aborted ? null : await claimNext(db, waiting); next; next = signal?.aborted ? null : await claimNext(db, waiting)) {
		worked = true;
		await work(next.file, next.token);
	}
	return worked;
}

/**
 * The publication worker's PDF import cycle: a few readers each take the
 * next PDF waiting as soon as they finish one, until none waits, so a slow
 * PDF holds up only its own reader; beside them, a couple more give the
 * imported drafts their PDFs. A failed read or attachment is retried a few
 * times, then shown as failed.
 */
export async function runPdfImportCycle(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, signal?: AbortSignal) {
	await removeLateImportFiles(db, storage).catch((error: unknown) => console.error("Removing closed imports' PDFs failed", error));
	const done = await Promise.all([
		...Array.from({ length: READ_AT_ONCE }, () => drain(db, TO_READ, signal, (file, token) => readClaimed(db, storage, config, file, token, signal))),
		...Array.from({ length: ATTACH_AT_ONCE }, () => drain(db, TO_ATTACH, signal, (file, token) => attachClaimed(db, storage, config, file, token))),
	]);
	return done.some(Boolean);
}
