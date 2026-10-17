import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { lockItemMutations } from "@/db/canonical-mutation-lock";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { itemSourceFileChoice, type SourceFileChoice } from "@/db/schema/review";
import { itemFilePublication, sourceConnection, sourceSyncState } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { createManifestSourceCredentialResolver } from "@/lib/source-ingestion/credentials";
import { createZoteroConnectionClient, loadZoteroSourceConnection } from "@/lib/source-ingestion/zotero/connection";

import { NATIVE_SOURCE_CONNECTION_KEY } from "./constants";
import type { AdminFileState, AdminSourcePdf } from "./types";
import { AdminValidationError } from "./errors";
import type { EvidenceFileStorage } from "./file-storage";
import { discardNativePdfDraft, stageNativePdfRemoval, undoNativePdfRemoval } from "./native-file-service";

/**
 * A Zotero attachment's PDF stays Zotero's file: the source's import publishes it, by the source's rule or by the
 * choice an editor made here, through review. The choice lives only in the library, so it works with writeback off.
 */
export type SourceFileChoiceRow = typeof itemSourceFileChoice.$inferSelect;

/** An attachment whose PDF its source holds: Zotero stores the file, and its import publishes it or not. */
function isSourcePdf(row: Pick<typeof item.$inferSelect, "itemType" | "deleted" | "contentType" | "linkMode" | "sourceConnectionKey"> | null | undefined) {
	return Boolean(
		row &&
			row.itemType === "Attachment" &&
			row.deleted !== 1 &&
			row.sourceConnectionKey !== NATIVE_SOURCE_CONNECTION_KEY &&
			row.contentType?.toLowerCase() === "application/pdf" &&
			(row.linkMode === "imported_file" || row.linkMode === "imported_url"),
	);
}

export async function readSourceFileChoices(db: Database | DatabaseTransaction, keys: readonly string[]) {
	if (keys.length === 0) return new Map<string, SourceFileChoiceRow>();
	const rows = await db.select().from(itemSourceFileChoice).where(inArray(itemSourceFileChoice.itemKey, [...keys]));
	return new Map(rows.map((row) => [row.itemKey, row]));
}

async function lockSourcePdf(transaction: DatabaseTransaction, itemKey: string) {
	await lockItemMutations(transaction, [itemKey]);
	const [row] = await transaction
		.select({ item, provider: sourceConnection.provider, published: itemFilePublication.itemKey, choice: itemSourceFileChoice })
		.from(item)
		.innerJoin(sourceConnection, eq(sourceConnection.key, item.sourceConnectionKey))
		.leftJoin(itemFilePublication, eq(itemFilePublication.itemKey, item.key))
		.leftJoin(itemSourceFileChoice, eq(itemSourceFileChoice.itemKey, item.key))
		.where(eq(item.key, itemKey))
		.limit(1);
	if (!row || row.provider !== "zotero" || !isSourcePdf(row.item))
		throw new AdminValidationError("Only a Zotero attachment's PDF is published or taken down here.");
	if (row.choice?.reviewId)
		throw new AdminValidationError("This PDF is in a pending review. Withdraw the review to change it.");
	return row;
}

/** Saves the change in the working draft, or removes it; a row with neither a choice nor a change goes. */
async function savePending(
	transaction: DatabaseTransaction,
	row: Awaited<ReturnType<typeof lockSourcePdf>>,
	pending: SourceFileChoice | null,
	sizeBytes?: number,
) {
	if (!pending && !row.choice?.choice) {
		await transaction.delete(itemSourceFileChoice).where(eq(itemSourceFileChoice.itemKey, row.item.key));
		return;
	}
	await transaction
		.insert(itemSourceFileChoice)
		.values({
			itemKey: row.item.key,
			sourceConnectionKey: row.item.sourceConnectionKey,
			sourceRecordKey: row.item.sourceRecordKey ?? row.item.key,
			pending,
			sizeBytes: sizeBytes ?? null,
		})
		.onConflictDoUpdate({
			target: itemSourceFileChoice.itemKey,
			set: { pending, ...(sizeBytes === undefined ? {} : { sizeBytes }), updatedAt: new Date() },
		});
}

/** The PDF as Zotero holds it, read with the source's key. */
export async function downloadSourcePdf(db: Database, config: LibraryServerConfig, itemKey: string) {
	const [row] = await db.select().from(item).where(eq(item.key, itemKey)).limit(1);
	if (!isSourcePdf(row)) throw new AdminValidationError("This attachment has no Zotero PDF.");
	const connection = await loadZoteroSourceConnection(db, row!.sourceConnectionKey);
	const { client, prefix } = await createZoteroConnectionClient(connection, {
		credentialResolver: createManifestSourceCredentialResolver(config.sources),
	});
	const { bytes } = await client.downloadAttachment(prefix, row!.sourceRecordKey ?? row!.key, config.services.storage.maxPdfBytes);
	return { bytes, filename: row!.filename ?? `${row!.key}.pdf`, sourceConnectionKey: row!.sourceConnectionKey };
}

/** Stages a Zotero PDF the library doesn't publish, to publish it once a review approves it. */
export async function stageSourcePdf(db: Database, config: LibraryServerConfig, itemKey: string) {
	// Read before the lock: it checks the file is there and how large it is.
	const { bytes, sourceConnectionKey } = await downloadSourcePdf(db, config, itemKey);
	if (!zoteroSource(config, sourceConnectionKey)?.settings.downloadPdfs)
		throw new AdminValidationError("This source adds no PDFs. Turn on its PDFs in the library's settings first.");
	await db.transaction(async (transaction) => {
		const row = await lockSourcePdf(transaction, itemKey);
		if (row.published) throw new AdminValidationError("This PDF is already published.");
		await savePending(transaction, row, "publish", bytes.byteLength);
	});
}

/** Marks a published Zotero PDF to come down once a review approves it, or undoes that. */
async function setSourcePdfRemoval(db: Database, itemKey: string, remove: boolean) {
	await db.transaction(async (transaction) => {
		const row = await lockSourcePdf(transaction, itemKey);
		if (remove && !row.published) throw new AdminValidationError("This PDF isn't published.");
		if (!remove && row.choice?.pending !== "withhold") return;
		await savePending(transaction, row, remove ? "withhold" : null);
	});
}

/** Drops a staged Zotero PDF from the working draft. */
async function discardSourcePdfStage(db: Database, itemKey: string) {
	await db.transaction(async (transaction) => {
		const row = await lockSourcePdf(transaction, itemKey);
		if (row.choice?.pending === "publish") await savePending(transaction, row, null);
	});
}

/** Whether these records hold a Zotero PDF change no review has yet. */
export async function hasUnsubmittedSourceFileChoice(db: Database | DatabaseTransaction, keys: readonly string[]) {
	if (keys.length === 0) return false;
	// An attachment deleted in Zotero leaves the review, so a change staged on it is no longer one to submit.
	const [row] = await db
		.select({ itemKey: itemSourceFileChoice.itemKey })
		.from(itemSourceFileChoice)
		.innerJoin(item, eq(item.key, itemSourceFileChoice.itemKey))
		.where(and(inArray(itemSourceFileChoice.itemKey, [...keys]), isNotNull(itemSourceFileChoice.pending), isNull(itemSourceFileChoice.reviewId), ne(item.deleted, 1)))
		.limit(1);
	return Boolean(row);
}

/** The Zotero PDF changes these records hold that no review has yet, as a review keeps them. */
export async function unsubmittedSourcePdfChanges(db: DatabaseTransaction, keys: readonly string[]) {
	const rows = [...(await readSourceFileChoices(db, keys)).values()];
	return rows.flatMap((row) => (row.pending && !row.reviewId ? [{ itemKey: row.itemKey, change: row.pending, sizeBytes: row.sizeBytes }] : []));
}

/** The review a record is submitted for holds its attachments' PDF changes. */
export async function holdSourceFileChoices(transaction: DatabaseTransaction, reviewId: string, keys: readonly string[]) {
	if (keys.length === 0) return;
	await transaction
		.update(itemSourceFileChoice)
		.set({ reviewId })
		.where(and(inArray(itemSourceFileChoice.itemKey, [...keys]), isNotNull(itemSourceFileChoice.pending), isNull(itemSourceFileChoice.reviewId)));
}

/** A review withdrawn or returned gives its PDF changes back to the working draft. */
export async function releaseSourceFileChoices(transaction: DatabaseTransaction, reviewId: string) {
	await transaction.update(itemSourceFileChoice).set({ reviewId: null }).where(eq(itemSourceFileChoice.reviewId, reviewId));
}

/**
 * An approved review makes its PDF changes the library's choices, and asks their sources to run now: each import
 * publishes or takes down the PDF on its next run and marks the choice applied.
 */
export async function applySourceFileChoices(transaction: DatabaseTransaction, reviewId: string) {
	const now = new Date();
	const applied = await transaction
		.update(itemSourceFileChoice)
		.set({ choice: sql`${itemSourceFileChoice.pending}`, pending: null, reviewId: null, applied: false, updatedAt: now })
		.where(eq(itemSourceFileChoice.reviewId, reviewId))
		.returning({ sourceConnectionKey: itemSourceFileChoice.sourceConnectionKey });
	const sources = [...new Set(applied.map(({ sourceConnectionKey }) => sourceConnectionKey))];
	if (sources.length)
		await transaction
			.update(sourceSyncState)
			.set({ runRequestedAt: sql`coalesce(${sourceSyncState.runRequestedAt}, ${now}::timestamptz)` })
			.where(inArray(sourceSyncState.sourceConnectionKey, sources));
}

/** A source's approved choices, by the Zotero key the import reads, and those it hasn't applied yet. */
export async function sourceFileChoicesFor(db: Database, sourceConnectionKey: string) {
	const rows = await db
		.select({
			itemKey: itemSourceFileChoice.itemKey,
			sourceRecordKey: itemSourceFileChoice.sourceRecordKey,
			choice: itemSourceFileChoice.choice,
			applied: itemSourceFileChoice.applied,
			// Postgres keeps microseconds a JavaScript date drops, so the time a choice was read is kept as Postgres wrote it.
			version: sql<string>`${itemSourceFileChoice.updatedAt}::text`,
		})
		.from(itemSourceFileChoice)
		.where(and(eq(itemSourceFileChoice.sourceConnectionKey, sourceConnectionKey), isNotNull(itemSourceFileChoice.choice)));
	return {
		choices: new Map(rows.map((row) => [row.sourceRecordKey, row.choice!])),
		unapplied: rows.filter((row) => !row.applied),
	};
}

/** Marks choices the import applied, unless one changed again while it ran. */
export async function markSourceFileChoicesApplied(db: Database, rows: readonly { itemKey: string; version: string }[]) {
	for (const row of rows)
		await db
			.update(itemSourceFileChoice)
			.set({ applied: true })
			.where(and(eq(itemSourceFileChoice.itemKey, row.itemKey), sql`${itemSourceFileChoice.updatedAt}::text = ${row.version}`));
}

/** Whether this attachment's PDF is its Zotero source's, for routes shared with the library's own files. */
async function isSourcePdfItem(db: Database, itemKey: string) {
	const [row] = await db
		.select({ item, provider: sourceConnection.provider })
		.from(item)
		.innerJoin(sourceConnection, eq(sourceConnection.key, item.sourceConnectionKey))
		.where(eq(item.key, itemKey))
		.limit(1);
	return row?.provider === "zotero" && isSourcePdf(row.item);
}

function sourcePdfFileState(choice: SourceFileChoiceRow | undefined, hasPublication: boolean): AdminFileState {
	if (hasPublication) return "published";
	if (choice?.pending === "publish") return "staged";
	return choice && !choice.applied ? "processing" : "unpublished";
}

/** A staged Zotero PDF, shown like an uploaded one: its name, its size in Zotero, and its Zotero checksum. */
function stagedSourcePdf(published: typeof item.$inferSelect, choice: SourceFileChoiceRow) {
	const at = choice.updatedAt.toISOString();
	return { actualSha256: null, actualSizeBytes: choice.sizeBytes, coverHeight: null, coverWidth: null, expectedSha256: published.md5 ?? "", expectedSizeBytes: choice.sizeBytes ?? 0, filename: published.filename ?? `${published.key}.pdf`, itemKey: published.key, pageCount: null, readyAt: at, updatedAt: at, uploadRevision: 0 };
}

/** The tags that publish a source's PDFs; null when it publishes every one. */
function publishTagsOf(rule: { mode: "tagged" | "every"; tags: string[] } | undefined) {
	return rule?.mode === "every" ? null : (rule?.tags ?? []);
}

/** A Zotero source's PDF settings: whether it adds PDFs, and the tags that publish them. */
function zoteroSource(config: Pick<LibraryServerConfig, "sources">, sourceConnectionKey: string) {
	const source = config.sources.find((entry) => entry.key === sourceConnectionKey);
	return source?.provider === "zotero" ? source : null;
}

/**
 * How the admin shows a Zotero attachment's PDF: published, staged to publish, being applied by the import, or not
 * published; the reason; and the file to open, read from Zotero. Nothing for any other attachment.
 */
export function projectSourcePdf(
	published: typeof item.$inferSelect | null,
	choice: SourceFileChoiceRow | undefined,
	hasPublication: boolean,
	config: Pick<LibraryServerConfig, "sources">,
) {
	// Other sources' PDFs, such as OpenAlex's, keep the library's ordinary file actions.
	const source = published && zoteroSource(config, published.sourceConnectionKey);
	if (!source || !isSourcePdf(published)) return null;
	const sourcePdf: AdminSourcePdf = {
		pdfsOn: source.settings.downloadPdfs,
		publishTags: publishTagsOf(source.settings.pdfPublishing),
		choice: choice?.choice ?? null,
		pending: choice?.pending ?? null,
		inReview: Boolean(choice?.reviewId),
		applied: choice?.applied ?? true,
	};
	return {
		fileState: sourcePdfFileState(choice, hasPublication),
		fileDraft: choice?.pending === "publish" ? stagedSourcePdf(published, choice) : null,
		fileRemovalPending: choice?.pending === "withhold",
		sourceFileUrl: `/api/admin/items/${encodeURIComponent(published.key)}/file/source`,
		sourcePdf,
	};
}

/** Marks an attachment's PDF to come down in the working draft, or undoes that: a Zotero PDF by the library's choice. */
export async function changePdfRemoval(runtime: { db: Database; storage: EvidenceFileStorage }, itemKey: string, remove: boolean) {
	if (await isSourcePdfItem(runtime.db, itemKey)) return setSourcePdfRemoval(runtime.db, itemKey, remove);
	return remove ? stageNativePdfRemoval(runtime.db, runtime.storage, itemKey) : undoNativePdfRemoval(runtime.db, itemKey);
}

/** Drops a staged PDF from the working draft: a Zotero PDF's stage, or an uploaded file. */
export async function discardPdfDraft(runtime: { db: Database; storage: EvidenceFileStorage }, itemKey: string) {
	if (await isSourcePdfItem(runtime.db, itemKey)) return discardSourcePdfStage(runtime.db, itemKey);
	return discardNativePdfDraft(runtime.db, runtime.storage, itemKey);
}
