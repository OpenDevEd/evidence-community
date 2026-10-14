import "server-only";

import { createHash } from "node:crypto";

import { itemDraft } from "@opendeved/evidence-library-core";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";

import type { Database } from "@/db";
import { pdfImport, pdfImportFile, type ImportSend } from "@/db/schema/pdf-import";
import { itemReview } from "@/db/schema/review";
import { item } from "@/db/schema/tables/item";

import { AdminValidationError } from "./errors";
import type { EvidenceFileStorage } from "./file-storage";
import { applyItemDraftPatch } from "./item-draft-merge";
import type { AdminImportCommitRequest, AdminImportCommitResult, AdminPdfImport, AdminPdfImportFile, AdminPdfImportStatus, PdfReading, PublishNeeds } from "./item-import-contract";
import { commitImportRecords } from "./item-import-service";
import { completeNativePdfUpload, stageNativePdfUpload } from "./native-file-service";
import { createNativeItemDraft } from "./native-item-service";
import { importObjectPath, removeImportFiles } from "./pdf-import-reading";
import { routeChoice } from "./review-contract";
import { publishingNeeds } from "./review-validation";

const PDF = "application/pdf";

// The editor's tab sends a few PDFs at a time. When none has arrived for this long, the rest never will: the tab closed
// or lost the connection.
const UPLOAD_WAIT_MS = 15 * 60_000;
// How long one request may hold the import while it imports the records.
const COMMIT_WAIT_MS = 10 * 60_000;
const NOT_UPLOADED = "The PDF didn't finish uploading.";

type FileRow = typeof pdfImportFile.$inferSelect;

function fileState(file: FileRow, lastUpload: Date, now: Date): AdminPdfImportFile["state"] {
	if (!file.objectPath) return file.lastError || now.getTime() - lastUpload.getTime() > UPLOAD_WAIT_MS ? "failed" : "uploading";
	if (file.reading) return "read";
	if (!file.nextAttemptAt) return "failed";
	return file.leaseExpiresAt && file.leaseExpiresAt > now ? "reading" : "waiting";
}

/** When the import last heard from the tab sending its PDFs: its start, or the last PDF that arrived. */
const lastUpload = (startedAt: Date, files: FileRow[]) => new Date(Math.max(startedAt.getTime(), ...files.map(({ uploadedAt }) => uploadedAt?.getTime() ?? 0)));

/**
 * The PDFs that are the same file as one earlier in the import, which can't
 * be imported twice. A PDF the worker already found repeated, without a
 * read, doesn't count as the first.
 */
function repeatedFiles(files: FileRow[]) {
	const seen = new Set<string>();
	const repeats = new Set<string>();
	for (const { id, reading } of files) {
		if (!reading || reading.record.state === "repeated") continue;
		if (seen.has(reading.sha256)) repeats.add(id);
		seen.add(reading.sha256);
	}
	return repeats;
}

// A ready record of a repeated PDF repeats the earlier one; one already found in the library stays found.
const asRepeat = (reading: PdfReading): PdfReading => (reading.record.state === "ready" ? { ...reading, record: { ...reading.record, state: "repeated" } } : reading);

/** Where sending each imported draft on stands, by row, for an import that sends them: waiting, held or failed with why. Sent ones are in `sent`. */
const sendStates = (files: FileRow[]): AdminPdfImport["sending"] =>
	Object.fromEntries(files.flatMap(({ position, sendError, sendState }) => (sendState && sendState !== "sent" ? [[String(position), { message: sendError, state: sendState }]] : [])));

/** What attaching did for each imported draft, by its row: attached, or failed for good. */
const attachOutcomes = (files: FileRow[]) =>
	Object.fromEntries(files.flatMap(({ attachState, position }) => (attachState === "attached" || attachState === "failed" ? [[String(position), attachState]] : [])));

const ROUTES = [null, "zenodo", "crossref-zenodo"] as const;

/**
 * What a draft still needs to publish with no DOI and on each DOI route, as
 * the record editor's Review requirements say it. A draft imported with its
 * own DOI keeps it, so only publishing with none applies to it.
 */
function publishNeedsOf(patch: Record<string, unknown>, kind: AdminImportCommitResult["kind"]): PublishNeeds {
	// A draft never published is its patch over nothing.
	const payload = applyItemDraftPatch({}, patch);
	const routes = kind === "created" ? ROUTES : ([null] as const);
	return Object.fromEntries(routes.map((route) => [route ?? "none", publishingNeeds(payload, routeChoice(route))] as const).filter(([, fields]) => Object.keys(fields).length));
}

/** The needs of the drafts not sent on yet, by row; a draft that needs nothing is left out. */
function unsentNeeds(drafts: AdminImportCommitResult[], patches: { key: string; patch: Record<string, unknown> }[], sent: AdminPdfImport["sent"]) {
	const draftByKey = new Map(drafts.map((draft) => [draft.itemKey, draft]));
	const needs = patches.flatMap(({ key, patch }) => {
		const { id, kind } = draftByKey.get(key)!;
		return sent[id] ? [] : [[id, publishNeedsOf(patch, kind)] as const];
	});
	return Object.fromEntries(needs.filter(([, routes]) => Object.keys(routes).length));
}

/**
 * Where the imported drafts stand, by row: those already sent on (published
 * ones are records now, submitted ones wait in a review, which is given too),
 * and what the rest still need to publish.
 */
async function draftStates(db: Database, results: AdminImportCommitResult[] | null): Promise<Pick<AdminPdfImport, "needs" | "reviews" | "sent">> {
	const drafts = (results ?? []).filter(({ itemKey, outcome }) => outcome === "created" && itemKey);
	if (!drafts.length) return { needs: {}, reviews: {}, sent: {} };
	const rowByKey = new Map(drafts.map(({ id, itemKey }) => [itemKey!, id]));
	const keys = [...rowByKey.keys()];
	// One snapshot for all three, so an approval committing between them can't hide a draft or show it twice.
	const [published, waiting, patches] = await db.transaction(
		async (snapshot) => [
			await snapshot.select({ key: item.key }).from(item).where(inArray(item.key, keys)),
			await snapshot.select({ id: itemReview.id, key: itemReview.itemKey, revision: itemReview.revision }).from(itemReview).where(and(inArray(itemReview.itemKey, keys), eq(itemReview.state, "pending"))),
			await snapshot.select({ key: itemDraft.itemKey, patch: itemDraft.patch }).from(itemDraft).where(inArray(itemDraft.itemKey, keys)),
		] as const,
		{ accessMode: "read only", isolationLevel: "repeatable read" },
	);
	const sent: AdminPdfImport["sent"] = Object.fromEntries([...waiting.map(({ key }) => [rowByKey.get(key)!, "submitted"]), ...published.map(({ key }) => [rowByKey.get(key)!, "published"])]);
	return {
		needs: unsentNeeds(drafts, patches, sent),
		reviews: Object.fromEntries(waiting.map(({ id, key, revision }) => [rowByKey.get(key)!, { id, revision }])),
		sent,
	};
}

/** The library's open import with where each PDF has got to, and the checks and instructions a new one starts from. */
export async function pdfImportStatus(db: Database): Promise<AdminPdfImportStatus> {
	const [open] = await db.select().from(pdfImport).where(isNull(pdfImport.closedAt)).limit(1);
	const [last] = open ? [open] : await db.select().from(pdfImport).orderBy(desc(pdfImport.createdAt)).limit(1);
	const lastUsed = { checks: last?.checks ?? [], instructions: last?.instructions ?? "" };
	if (!open) return { import: null, last: lastUsed };
	const files = await db.select().from(pdfImportFile).where(eq(pdfImportFile.importId, open.id)).orderBy(asc(pdfImportFile.position));
	const now = new Date();
	const repeats = repeatedFiles(files);
	const heard = lastUpload(open.createdAt, files);
	const view: AdminPdfImport = {
		attach: attachOutcomes(files),
		checks: open.checks,
		collections: open.collections,
		createdAt: open.createdAt.toISOString(),
		files: files.map((file) => {
			const state = fileState(file, heard, now);
			const reading = repeats.has(file.id) ? asRepeat(file.reading!) : file.reading;
			return { filename: file.filename, id: file.id, message: state === "failed" ? (file.lastError ?? NOT_UPLOADED) : null, reading, rowId: String(file.position), state, stored: Boolean(file.objectPath) };
		}),
		id: open.id,
		instructions: open.instructions,
		results: open.results,
		send: open.send && { action: open.send.actor.role === "creator" ? "submit" : "publish", route: open.send.route },
		sending: sendStates(files),
		...(await draftStates(db, open.results)),
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
		.set({ nextAttemptAt: new Date(), objectPath, uploadedAt: new Date() })
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

/** An open import's PDF, for its cover and for opening it in the review; a closed import's PDFs are gone. */
export async function readPdfImportFile(db: Database, storage: EvidenceFileStorage, fileId: string) {
	const [file] = await db
		.select({ filename: pdfImportFile.filename, objectPath: pdfImportFile.objectPath })
		.from(pdfImportFile)
		.innerJoin(pdfImport, eq(pdfImport.id, pdfImportFile.importId))
		.where(and(eq(pdfImportFile.id, fileId), isNotNull(pdfImportFile.objectPath), isNull(pdfImport.closedAt)));
	if (!file?.objectPath) throw new AdminValidationError("This PDF is not uploaded.");
	return { bytes: await storage.downloadPrivate(file.objectPath), filename: file.filename };
}

/**
 * Ends the import, kept or discarded, and removes its stored PDFs; imported
 * drafts keep their own copies. It waits while the worker still gives drafts
 * their PDFs, which it reads from those stored copies.
 */
export async function closePdfImport(db: Database, storage: EvidenceFileStorage, importId: string) {
	await db.transaction(async (transaction) => {
		// The import's row is locked, as making its drafts locks it, so a close and an import never pass each other.
		const [current] = await transaction.select().from(pdfImport).where(eq(pdfImport.id, importId)).for("update");
		if (!current || current.closedAt) return;
		if (!current.results && current.commitStartedAt && current.commitStartedAt.getTime() > Date.now() - COMMIT_WAIT_MS) throw new AdminValidationError("The records are being imported. Close the import once they are.");
		const [attaching] = await transaction.select({ id: pdfImportFile.id }).from(pdfImportFile).where(and(eq(pdfImportFile.importId, importId), eq(pdfImportFile.attachState, "waiting"))).limit(1);
		if (attaching) throw new AdminValidationError("The drafts are still getting their PDFs. Close the import once they have them.");
		// The worker sends them on from the import, so it stays open until it has.
		const [sending] = await transaction.select({ id: pdfImportFile.id }).from(pdfImportFile).where(and(eq(pdfImportFile.importId, importId), eq(pdfImportFile.attachState, "attached"), eq(pdfImportFile.sendState, "waiting"))).limit(1);
		if (sending) throw new AdminValidationError("The drafts are still being sent on. Close the import once they have been.");
		await transaction.update(pdfImport).set({ closedAt: new Date() }).where(eq(pdfImport.id, importId));
	});
	// The worker removes them again once their upload links have stopped working, and so retries what a storage failure leaves.
	await removeImportFiles(db, storage, importId).catch((error: unknown) => console.error("Removing an import's stored PDFs failed", importId, error));
}

/**
 * Makes the drafts, keeps their results on the import and queues each
 * draft's PDF for the worker, in one transaction, so a retry never makes
 * them twice and no draft is left waiting for a PDF nobody queued.
 */
type CommitInput = Omit<AdminImportCommitRequest, "action" | "send"> & { send?: ImportSend };

async function createDrafts(db: Database, input: CommitInput) {
	return db.transaction(async (transaction) => {
		const [current] = await transaction.select({ closedAt: pdfImport.closedAt }).from(pdfImport).where(eq(pdfImport.id, input.importId)).for("update");
		if (current?.closedAt) throw new AdminValidationError("This import was closed in another tab.");
		const { results } = await commitImportRecords(transaction, { ...input, action: "commit", send: null });
		await transaction.update(pdfImport).set({ results, send: input.send ?? null }).where(eq(pdfImport.id, input.importId));
		for (const { id, itemKey, outcome } of results) {
			if (outcome !== "created" || !itemKey) continue;
			// A draft sent on goes once its PDF is attached, so it waits with it.
			await transaction
				.update(pdfImportFile)
				.set({ attachState: "waiting", attachTo: itemKey, attempts: 0, nextAttemptAt: new Date(), sendState: input.send ? "waiting" : null })
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
export async function commitPdfImport(db: Database, input: CommitInput) {
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
