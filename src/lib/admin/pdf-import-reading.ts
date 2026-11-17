import "server-only";

import { licenceFromRights } from "@/lib/licences";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { itemDraft, itemFileDraft } from "@opendeved/evidence-library-core";
import { canonicalZoteroFieldName, getZoteroItemType } from "@opendeved/evidence-library-core/zotero-schema";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db";
import { pdfImport, pdfImportFile } from "@/db/schema/pdf-import";
import { itemFilePublication } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { canonicalItemFieldToDatabaseField, primaryCreatorType } from "@/lib/item-field-codec";
import { languageTag } from "@/lib/languages";

import type { EvidenceFileStorage } from "./file-storage";
import type { PdfReading } from "./item-import-contract";
import { previewEntries } from "./item-import-service";
import { completeNativePdfUpload, stageNativePdfUpload } from "./native-file-service";
import { createNativeItemDraft } from "./native-item-service";
import { readImportPdf } from "./pdf-import";
import { keepImportChecks } from "./import-checks";
import { sendImportedDraft, sendingOf } from "./pdf-import-send";
import { readPdfProperties } from "./pdf-properties";

// The worker's side of the PDF import: it reads each uploaded PDF with the
// library's AI and, once the records are imported, gives each draft its PDF.

// The worker gives up on a PDF after this many failed reads, or failed attachments.
const MAX_ATTEMPTS = 3;
// PDFs the worker reads at once, and PDFs it attaches at once.
const READ_AT_ONCE = 8;
const ATTACH_AT_ONCE = 2;
// Drafts it sends on at once, once their PDFs are attached, for an import that sends them.
const SEND_AT_ONCE = 2;
// How often a free reader looks for a PDF that arrived while others are still reading.
const LOOK_AGAIN_MS = 2_000;
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

/** A suggestion under the record's name for its field, a language as its code; an empty value when it has none. */
function inRecordForm<Suggestion extends { field: string; value: string }>(itemType: unknown, suggestion: Suggestion): Suggestion {
	const field = recordField(itemType, suggestion.field);
	return { ...suggestion, field, value: field === "languageName" ? languageCode(suggestion.value) : suggestion.value };
}

/** The record's own name for a field the AI named as Zotero does: a report's institution is its publisher, a language its languageName. */
const recordField = (itemType: unknown, field: string) => canonicalItemFieldToDatabaseField(canonicalZoteroFieldName(String(itemType), field) ?? field);

/**
 * The library's record whose PDF is this very file: a draft's upload, a
 * published copy, or a PDF an earlier import attached. Publishing writes the
 * record into its copy, which changes its hash, so the import's own note of
 * the file is what finds a published import again.
 */
async function fileOwner(db: Database, sha256: string) {
	const [draft] = await db.select({ key: itemFileDraft.parentItemKey }).from(itemFileDraft).where(eq(itemFileDraft.actualSha256, sha256)).limit(1);
	if (draft) return draft.key;
	const [imported] = await db.select({ key: pdfImportFile.attachTo }).from(pdfImportFile).where(and(eq(pdfImportFile.sha256, sha256), eq(pdfImportFile.attachState, "attached"))).limit(1);
	if (imported?.key) return imported.key;
	const [published] = await db.select({ key: itemFilePublication.parentItemKey }).from(itemFilePublication).where(eq(itemFilePublication.sha256, sha256)).limit(1);
	return published?.key;
}

/** A record's title as published, or as its draft has it when it isn't published; null when the record is gone. */
async function recordTitle(db: Database, key: string) {
	const [record] = await db.select({ title: item.title }).from(item).where(eq(item.key, key));
	if (record) return { title: record.title };
	const [draft] = await db.select({ patch: itemDraft.patch }).from(itemDraft).where(eq(itemDraft.itemKey, key));
	return draft ? { title: (draft.patch as { title?: string }).title || null } : null;
}

/** The library's record whose PDF is this very file, with its title, while that record still exists. */
async function recordWithFile(db: Database, sha256: string) {
	const key = await fileOwner(db, sha256);
	const record = key ? await recordTitle(db, key) : null;
	return key && record ? { key, title: record.title } : null;
}

const isUniqueViolation = (error: unknown) => (error as { code?: string; cause?: { code?: string } }).code === "23505" || (error as { cause?: { code?: string } }).cause?.code === "23505";

/**
 * Keeps the PDF's hash on its row; false when another PDF of the import
 * holds it already, being the same file. The import allows each hash once,
 * so of two copies read at the same moment, only one goes to the AI.
 */
async function ownsFile(db: Database, file: FileRow, sha256: string) {
	try {
		await db.update(pdfImportFile).set({ sha256 }).where(eq(pdfImportFile.id, file.id));
		return true;
	} catch (error) {
		if (isUniqueViolation(error)) return false;
		throw error;
	}
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

/**
 * The record with the licence its PDF's rights statement names. One that names none leaves it for a person to pick: an
 * import never takes the library's default licence by itself.
 */
function withFoundLicence(payload: Record<string, unknown> | null) {
	const licence = licenceFromRights(typeof payload?.rights === "string" ? payload.rights : null);
	return payload && licence ? { ...payload, licence: { kind: "zenodo", id: licence } } : payload;
}

async function readOne(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, file: FileRow, signal: AbortSignal | undefined): Promise<PdfReading> {
	const [owner] = await db.select().from(pdfImport).where(eq(pdfImport.id, file.importId));
	const bytes = await storage.downloadPrivate(file.objectPath!);
	const limit = config.services.storage.maxPdfBytes;
	if (bytes.byteLength > limit) throw new UnreadablePdfError(`This PDF is larger than the community takes (${Math.floor(limit / 1024 / 1024)} MB).`);
	// The file is known before the AI is asked, so a PDF the library or this import already has costs no read.
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const pdf = await readPdfProperties(bytes);
	const existing = await recordWithFile(db, sha256);
	if (existing || !(await ownsFile(db, file, sha256))) return sameFileReading(file, pdf, sha256, existing);
	// The editor who started the import is who OpenScholar's author search answers.
	const readSignal = AbortSignal.any([AbortSignal.timeout(READ_TIMEOUT_MS), ...(signal ? [signal] : [])]);
	const ai = await readImportPdf({ clerkUserId: owner!.createdBy, config, database: db, signal: readSignal }, { bytes, checks: owner!.checks, filename: file.filename, instructions: owner!.instructions, pdf });
	const read = await previewReading(db, file.filename, inLibraryForms(ai.zoteroItem));
	const record = { ...read, id: String(file.position), payload: withFoundLicence(read.payload) };
	// Suggestions use the record's field names and forms, so applying one replaces the field the review shows; one that
	// changes nothing is dropped.
	const suggestions = ai.suggestions.map((suggestion) => inRecordForm(ai.zoteroItem.itemType, suggestion)).filter(({ field, value }) => value && record.payload?.[field] !== value);
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
const TO_SEND = sql`"attachState" = 'attached' AND "sendState" = 'waiting'`;

/** When a failed read or attachment is tried again, and null once it has been tried enough. */
const retryAt = (attempts: number, permanent: boolean) => (permanent || attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + 10_000 * 2 ** attempts));

async function readClaimed(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, file: FileRow, token: string, signal: AbortSignal | undefined) {
	const mine = and(eq(pdfImportFile.id, file.id), eq(pdfImportFile.leaseToken, token));
	try {
		const reading = await readOne(db, storage, config, file, signal);
		await db.update(pdfImportFile).set({ lastError: null, leaseExpiresAt: null, leaseToken: null, nextAttemptAt: null, reading: { ...reading, readAt: new Date().toISOString() } }).where(mine);
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

/**
 * The name the PDF takes as an attachment, which must end in .pdf, hold no
 * folders and fit 255 characters: a PDF a browser sent as "report" is
 * still a PDF.
 */
function attachmentName(filename: string) {
	const name = filename.split(/[\\/]/u).pop()!.trim() || "document";
	const stem = name.toLowerCase().endsWith(".pdf") ? name.slice(0, -4) : name;
	return `${stem.slice(0, 251)}.pdf`;
}

/** Gives a draft its PDF from the import, through the same staging an upload in the inspector takes. */
async function attachOne(db: Database, storage: EvidenceFileStorage, maxPdfBytes: number, file: FileRow) {
	const bytes = await storage.downloadPrivate(file.objectPath!);
	const itemKey = await attachmentFor(db, file);
	const staged = await stageNativePdfUpload(db, storage, {
		expectedSha256: createHash("sha256").update(bytes).digest("hex"),
		expectedSizeBytes: bytes.byteLength,
		filename: attachmentName(file.filename),
		itemKey,
		maxPdfBytes,
	});
	await storage.uploadPrivate(staged.fileDraft.objectPath, bytes, PDF);
	await completeNativePdfUpload(db, storage, { expectedUploadRevision: staged.fileDraft.uploadRevision, itemKey, maxPdfBytes });
	// The checks it was read against stay with this upload, so the record shows them while it keeps this PDF.
	if (file.reading) await keepImportChecks(db, { attachmentKey: itemKey, filename: file.filename, objectPath: staged.fileDraft.objectPath, parentKey: file.attachTo!, reading: file.reading });
}

async function attachClaimed(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, file: FileRow, token: string) {
	const mine = and(eq(pdfImportFile.id, file.id), eq(pdfImportFile.leaseToken, token));
	try {
		await attachOne(db, storage, config.services.storage.maxPdfBytes, file);
		// A draft the import sends on is due to go now that it has its PDF.
		await db.update(pdfImportFile).set({ attachState: "attached", lastError: null, leaseExpiresAt: null, leaseToken: null, nextAttemptAt: file.sendState === "waiting" ? new Date() : null }).where(mine);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const attempts = file.attempts + 1;
		const nextAttemptAt = retryAt(attempts, false);
		console.error("Attaching an imported PDF failed", { attempts, error: message, file: file.filename, itemKey: file.attachTo });
		// A PDF that won't attach ends its draft's send too, so the import doesn't wait on it.
		const sendEnds = !nextAttemptAt && file.sendState === "waiting" ? { sendError: "Its PDF didn't attach.", sendState: "failed" as const } : {};
		await db
			.update(pdfImportFile)
			.set({ attachState: nextAttemptAt ? "waiting" : "failed", attempts, lastError: message.slice(0, 2000), leaseExpiresAt: null, leaseToken: null, nextAttemptAt, ...sendEnds })
			.where(mine);
	}
}

/**
 * Sends a draft on once it has its PDF, and keeps how it went: sent, held
 * with what publishing needs, or failed with why. A failed one isn't tried
 * again here; the import's finish step can send it again.
 */
async function sendClaimed(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, file: FileRow, token: string) {
	const mine = and(eq(pdfImportFile.id, file.id), eq(pdfImportFile.leaseToken, token));
	const done = { leaseExpiresAt: null, leaseToken: null, nextAttemptAt: null };
	try {
		const draft = await sendingOf(db, file.importId, file.position);
		const sent = draft ? await sendImportedDraft(db, storage, config, { ...draft, attachmentKey: file.attachmentKey }) : { error: null, state: "sent" as const };
		await db.update(pdfImportFile).set({ ...done, sendError: sent.error, sendState: sent.state }).where(mine);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("Sending an imported draft on failed", { error: message, file: file.filename, itemKey: file.attachTo });
		await db.update(pdfImportFile).set({ ...done, sendError: message.slice(0, 2000), sendState: "failed" }).where(mine);
	}
}

/** What a cycle's readers and attachers share: the worker's stop, their claims under way, and how many PDFs they are working on. */
type Cycle = { claims: Set<Promise<unknown>>; signal: AbortSignal | undefined; working: number };

/** Runs `work` on each PDF claimed for it until there is nothing left to claim; true when it did any. */
async function drain(db: Database, waiting: ReturnType<typeof sql>, cycle: Cycle, work: (file: FileRow, token: string) => Promise<void>) {
	let worked = false;
	for (let next = await claimInCycle(db, waiting, cycle); next; next = await claimInCycle(db, waiting, cycle)) {
		worked = true;
		await work(next.file, next.token).finally(() => cycle.working--);
	}
	return worked;
}

/** Claims the next PDF waiting, as one of the cycle's claims under way; a claimed PDF counts as work until its work ends. */
function claimInto(db: Database, waiting: ReturnType<typeof sql>, cycle: Cycle) {
	const claimed = claimNext(db, waiting).then((next) => {
		if (next) cycle.working++;
		return next;
	});
	cycle.claims.add(claimed);
	return claimed.finally(() => cycle.claims.delete(claimed));
}

/**
 * The next PDF waiting for this work. When none waits but another in the
 * cycle is at work, it looks again every few seconds: an import's PDFs reach
 * storage seconds apart, and one that arrives mid-cycle gets a free reader
 * instead of waiting for a busy one. Before deciding nothing is at work it
 * lets the other claims under way settle, since one may bring a PDF. Null
 * once nothing is left, or when the worker is asked to stop, so a stopping
 * worker leaves the next PDF unclaimed.
 */
async function claimInCycle(db: Database, waiting: ReturnType<typeof sql>, cycle: Cycle) {
	while (!cycle.signal?.aborted) {
		const next = await claimInto(db, waiting, cycle);
		if (next) return next;
		await Promise.allSettled(cycle.claims);
		if (!cycle.working) return null;
		await delay(LOOK_AGAIN_MS, undefined, { signal: cycle.signal }).catch(() => undefined);
	}
	return null;
}

/**
 * The publication worker's PDF import cycle: a few readers each take the
 * next PDF waiting as soon as they finish one, until none waits and none is
 * at work, so a slow PDF holds up only its own reader; beside them, a couple
 * more give the imported drafts their PDFs. A failed read or attachment is
 * retried a few times, then shown as failed.
 */
export async function runPdfImportCycle(db: Database, storage: EvidenceFileStorage, config: LibraryServerConfig, signal?: AbortSignal) {
	await removeLateImportFiles(db, storage).catch((error: unknown) => console.error("Removing closed imports' PDFs failed", error));
	const cycle: Cycle = { claims: new Set(), signal, working: 0 };
	const done = await Promise.all([
		...Array.from({ length: READ_AT_ONCE }, () => drain(db, TO_READ, cycle, (file, token) => readClaimed(db, storage, config, file, token, signal))),
		...Array.from({ length: ATTACH_AT_ONCE }, () => drain(db, TO_ATTACH, cycle, (file, token) => attachClaimed(db, storage, config, file, token))),
		...Array.from({ length: SEND_AT_ONCE }, () => drain(db, TO_SEND, cycle, (file, token) => sendClaimed(db, storage, config, file, token))),
	]);
	return done.some(Boolean);
}
