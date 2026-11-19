import { useSyncExternalStore } from "react";
import type { FileAccess, RecordLicence } from "@/lib/licences";
import useSWR, { mutate } from "swr";
import { describeZoteroItemTypeFields } from "@opendeved/evidence-library-core/zotero-schema";

import {
	PDF_IMPORT_MAX_CRITERIA,
	PDF_IMPORT_MAX_CRITERION_LENGTH,
	PDF_IMPORT_MAX_FILE_BYTES,
	PDF_IMPORT_MAX_GUIDANCE_LENGTH,
	type CollectionSuggestion,
	type PdfCheckResult,
	type TopicSuggestion,
	ADMIN_IMPORT_MAX_FILE_BYTES,
	ADMIN_IMPORT_MAX_FILES,
	ADMIN_IMPORT_MAX_RECORDS,
	parseDoiList,
	type AdminImportCommitResult,
	type AdminImportPreviewRecord,
	type AdminImportPreviewRequest,
	type AdminPdfImport,
	type AdminPdfImportStatus,
	type PdfImportFileState,
	type PdfSuggestion,
	PDF_IMPORT_MAX_FILES,
} from "@/lib/admin/item-import-contract";
import type { AdminFieldErrors } from "@/lib/admin/errors";
import { normalizeAdminFieldValue } from "@/lib/admin/field-contract";
import type { PdfPropertiesReading } from "@/lib/admin/pdf-properties";
import { pdfPropertiesOfRecord, type PdfProperties } from "@/lib/admin/pdf-record-mapping";
import { routeChoice, type PublishingChoice } from "@/lib/admin/review-contract";
import { needsText, publishingNeeds } from "@/lib/admin/review-validation";

export { needsText };
import { normalizeDoi } from "@/lib/doi";
import { canonicalItemTypeToZotero } from "@/lib/item-field-codec";

import type { ImportKind, ImportStage } from "./ImportSteps";
import { AdminApiError, failAdminPdfImportUpload, getAdminPdfImport, PDF_IMPORT_KEY, pdfImportFileUrl } from "./admin-api";
import { useAdminLive } from "./admin-live";


/** A problem with what the user typed or chose, shown before any request. */
class ImportInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ImportInputError";
	}
}

type ImportPreviewInput = Omit<AdminImportPreviewRequest, "action">;

export function doiPreviewRequest(text: string): ImportPreviewInput {
	const { dois, invalid } = parseDoiList(text);
	if (invalid.length) {
		const shown = invalid.slice(0, 5).join(", ");
		throw new ImportInputError(
			`These entries name no paper: ${shown}${invalid.length > 5 ? "…" : ""}`,
		);
	}
	if (!dois.length) throw new ImportInputError("Paste at least one DOI or link to a paper.");
	if (dois.length > ADMIN_IMPORT_MAX_RECORDS) {
		throw new ImportInputError(
			`Import no more than ${ADMIN_IMPORT_MAX_RECORDS} records at once.`,
		);
	}
	return { dois, files: [] };
}

function validateImportFiles(files: readonly File[]): void {
	if (!files.length) throw new ImportInputError("Choose at least one file.");
	if (files.length > ADMIN_IMPORT_MAX_FILES) {
		throw new ImportInputError(
			`Choose no more than ${ADMIN_IMPORT_MAX_FILES} files at once.`,
		);
	}
	const oversized = files.find(({ size }) => size > ADMIN_IMPORT_MAX_FILE_BYTES);
	if (oversized) {
		throw new ImportInputError(`${oversized.name} is larger than 5 MB.`);
	}
	const empty = files.find(({ size }) => size === 0);
	if (empty) throw new ImportInputError(`${empty.name} is empty. Choose a file with records to import.`);
}

export async function filePreviewRequest(
	files: readonly File[],
): Promise<ImportPreviewInput> {
	validateImportFiles(files);
	return {
		dois: [],
		files: await Promise.all(
			files.map(async (file) => ({ content: await file.text(), name: file.name })),
		),
	};
}

export function selectedImportRecords(
	records: readonly AdminImportPreviewRecord[],
	selected: ReadonlySet<string>,
) {
	return records.flatMap(({ id, method, payload }) =>
		selected.has(id) && payload ? [{ id, method, payload }] : [],
	);
}

/** The drafts an import created, which the table selects. */
export function createdKeys(results: readonly AdminImportCommitResult[]) {
	return results.flatMap(({ itemKey, outcome }) => (outcome === "created" && itemKey ? [itemKey] : []));
}

/** One record in the review, from a DOI, a bibliography file or a PDF the AI reads. */
export type ImportRow = {
	checks: PdfCheckResult[];
	/** The library's records the PDF cites, which its record links to. */
	cites: { key: string; title: string }[];
	/** The row's id, also the id its record is committed under. */
	id: string;
	message?: string;
	/** The properties the PDF carries now. */
	pdf: PdfPropertiesReading | null;
	record: AdminImportPreviewRecord | null;
	/** The PDF this row reads, and where it opens once stored; null for DOIs and bibliography files. */
	source: { filename: string; url: string | null } | null;
	state: PdfImportFileState;
	/** Changes the AI suggests to the record's fields. */
	suggestions: PdfSuggestion[];
	topics: TopicSuggestion[];
	/** The library's collections the AI files the record in. */
	collections: CollectionSuggestion[];
};


function validatePdfFiles(files: readonly File[]): void {
	if (!files.length) throw new ImportInputError("Choose at least one PDF.");
	if (files.length > PDF_IMPORT_MAX_FILES) {
		throw new ImportInputError(`Choose no more than ${PDF_IMPORT_MAX_FILES} PDFs at once.`);
	}
	const notPdf = files.find(({ name, type }) => type !== "application/pdf" && !name.toLowerCase().endsWith(".pdf"));
	if (notPdf) throw new ImportInputError(`${notPdf.name} is not a PDF.`);
	const oversized = files.find(({ size }) => size > PDF_IMPORT_MAX_FILE_BYTES);
	if (oversized) throw new ImportInputError(`${oversized.name} is larger than 50 MB.`);
	const empty = files.find(({ size }) => size === 0);
	if (empty) throw new ImportInputError(`${empty.name} is empty.`);
}

function validateChecks(checks: readonly string[]) {
	if (checks.length > PDF_IMPORT_MAX_CRITERIA) {
		throw new ImportInputError(`Use no more than ${PDF_IMPORT_MAX_CRITERIA} checks.`);
	}
	const long = checks.find((check) => check.length > PDF_IMPORT_MAX_CRITERION_LENGTH);
	if (long) throw new ImportInputError(`Keep each check under ${PDF_IMPORT_MAX_CRITERION_LENGTH} characters.`);
}

function validateGuidance(guidance: string) {
	if (guidance.trim().length > PDF_IMPORT_MAX_GUIDANCE_LENGTH) throw new ImportInputError(`Keep the AI instructions under ${PDF_IMPORT_MAX_GUIDANCE_LENGTH} characters in all.`);
}

const emptyRow = { checks: [], cites: [], collections: [], pdf: null, source: null, suggestions: [], topics: [] };

export function rowsFromRecords(records: readonly AdminImportPreviewRecord[]): ImportRow[] {
	return records.map((record) => ({ ...emptyRow, id: record.id, record, state: "read" }));
}

/** The import's PDFs as review rows, with whatever the worker has read of each. */
function rowsFromImport(server: AdminPdfImport): ImportRow[] {
	return server.files.map((file) => ({
		...emptyRow,
		record: null,
		...file.reading,
		id: file.rowId,
		message: file.message ?? undefined,
		// No address until the PDF is stored, so a cover isn't drawn from a missing file.
		source: { filename: file.filename, url: file.stored ? pdfImportFileUrl(file.id) : null },
		state: file.state,
	}));
}

/** What a row is called: its record's title, else the PDF or file it came from. */
export const rowTitle = (row: ImportRow) => row.record?.title ?? row.source?.filename ?? row.record?.source ?? "";

/** A row's cover: its stored PDF's first page, else its type's icon, with the light passing down it while it's read. */
export const coverOf = (row: ImportRow) => ({ itemType: row.record?.itemType, pdf: row.source?.url ?? null, reading: row.state === "reading" });

/** Whether a row's record can be ticked to import. */
export const importable = (row: ImportRow) => row.record?.state === "ready";

/** The record as read, before the editor's changes. */
export const recordPayloadOf = (row: ImportRow) => row.record?.payload ?? {};

/** The library's record a row repeats, when the review found one. */
export const existingKeyOf = (row: ImportRow) => row.record?.existingKey;

/** Whether publishing can write the record into this row's PDF, which it can when the PDF opens without a password. */
export const writesProperties = (row: ImportRow) => Boolean(row.record && row.pdf?.writable);

/** What importing does with the chosen records. */
export type ImportOutcome = "drafts" | "send";

/** Whether importing gave a draft its PDF; the server does it while the drafts are made. */
export type AttachState = "attached" | "failed";
/** A draft sent on from the finish step: published by an editor or owner, or submitted for one, with its reserved Crossref DOI. */
export type PublishState = {
	doi?: string;
	message?: string;
	state: "failed" | "published" | "sending" | "submitted";
};

/**
 * The import being reviewed. It lives outside the dialog, so closing the
 * dialog keeps it. A DOI or bibliography import lives only here. A PDF
 * import lives on the server, read by the publication worker: its rows,
 * results and attachments come from there, and only the editor's choices
 * live here, so a reload keeps every reading but resets the ticks.
 */
export type ImportBatch = {
	/** Each record's applied suggestions, by their place, once the editor changes the AI's choice. */
	applied: ReadonlyMap<string, ReadonlySet<number>>;
	attach: ReadonlyMap<string, AttachState>;
	/** The checks the PDFs were read against. */
	checks: readonly string[];
	/** Collections the new drafts go into. */
	collections: string[];
	/** The import call is under way, so a reopened dialog can't send it twice. */
	committing: boolean;
	/** Ready records the editor unticked. */
	excluded: ReadonlySet<string>;
	/** The licence the editor picked for a record, in place of the one its PDF named. */
	licences: ReadonlyMap<string, RecordLicence>;
	/** Who the editor chose may get a record's files, in place of what its licence gives. */
	fileAccesses: ReadonlyMap<string, FileAccess>;
	importId: string;
	kind: ImportKind;
	/** What each imported draft not yet sent still needs to publish, as the server last said. */
	needs: AdminPdfImport["needs"];
	publish: ReadonlyMap<string, PublishState>;
	/** How drafts made from PDFs get their DOI, as on a record made in the library; null publishes them without one. */
	publishRoute: PublishingChoice["route"] | null;
	/** What importing does with the chosen records: keeps them as drafts, or sends them on (publishes them, or submits them for review) once their PDFs are attached. */
	outcome: ImportOutcome;
	/** Whether the server sends the imported drafts on, and how, and where each still to go stands. */
	send: AdminPdfImport["send"];
	sending: AdminPdfImport["sending"];
	results: AdminImportCommitResult[] | null;
	/** The pending review of each draft submitted and not yet decided, by row, as the server last said. */
	reviews: AdminPdfImport["reviews"];
	rows: ImportRow[];
	/** The drafts ticked for publishing, once the editor changes the default. */
	toPublish: ReadonlySet<string> | null;
	/** Whether the drafts this tab is sending on are being published (true) or sent to the review queue; null before a send. */
	sendApproves?: boolean | null;
	/** Each record's topics and collections, once the editor changes the AI's choice. */
	chosen: Record<ChoiceKind, ReadonlyMap<string, ReadonlySet<string>>>;
};

/** What the AI chooses from a library's own lists for a record. */
export type ChoiceKind = "collections" | "topics";

// The library's PDF import, kept on the server, and a DOI or bibliography import, kept in this tab, each with the
// editor's choices on it. They are kept apart, so importing DOIs while a PDF import waits keeps what was chosen in it.
let pdfs: ImportBatch | null = null;
let other: ImportBatch | null = null;
const listeners = new Set<() => void>();

function setSlot(slot: "other" | "pdfs", next: ImportBatch | null) {
	if (slot === "pdfs") pdfs = next;
	else other = next;
	for (const listener of listeners) listener();
}

export function startImportBatch(start: Pick<ImportBatch, "checks" | "collections" | "importId" | "kind" | "rows">) {
	setSlot(start.kind === "pdfs" ? "pdfs" : "other", { ...start, ...blankChoices, results: null });
}

const blankChoices = { applied: new Map(), attach: new Map(), committing: false, excluded: new Set<string>(), licences: new Map<string, RecordLicence>(), fileAccesses: new Map<string, FileAccess>(), needs: {}, outcome: "drafts" as ImportOutcome, publish: new Map(), publishRoute: null, reviews: {}, send: null, sendApproves: null, sending: {}, toPublish: null, chosen: { collections: new Map(), topics: new Map() } };

// The server's answer last taken in, so a poll that brings nothing new re-renders nothing.
let synced = "";
let syncedImport: AdminPdfImport | null = null;

/** Fired on the window with the item keys of drafts the server changed, as the import's polls report them. */
export const IMPORT_DRAFTS_CHANGED_EVENT = "admin-import-drafts-changed";

/**
 * The drafts of an import whose PDF the worker attached, or that the server sent on, between two answers about it:
 * the server changed them with no step taken in this tab. An import that closed or gave way to another since may have
 * changed any of its drafts before it went, so all of them count.
 */
export function changedDrafts(before: AdminPdfImport | null, after: AdminPdfImport | null): string[] {
	if (!before) return [];
	if (before.id !== after?.id) return createdKeys(before.results ?? []);
	const changed = (id: string) => before.attach[id] !== after.attach[id] || before.sent[id] !== after.sent[id] || before.sending[id]?.state !== after.sending[id]?.state;
	return createdKeys((after.results ?? []).filter(({ id }) => changed(id)));
}

/** What the server says of its import, as the review takes it. */
function fromServer(server: AdminPdfImport) {
	return { attach: new Map(Object.entries(server.attach)), checks: server.checks, needs: server.needs, results: server.results, reviews: server.reviews, rows: rowsFromImport(server), send: server.send, sending: server.sending };
}

// The editor's choices on the library's PDF import, kept in this browser so a reload keeps them. One import is open at
// a time, so one entry holds them.
const CHOICES_KEY = "evidence-library:pdf-import-choices";

type SavedChoices = {
	applied: [string, number[]][];
	/** How sending each draft on went; one still sending when the page went is left out, as it stopped there. */
	publish: [string, PublishState][];
	chosen: Record<ChoiceKind, [string, string[]][]>;
	collections: string[];
	excluded: string[];
	importId: string;
	licences?: [string, RecordLicence][];
	fileAccesses?: [string, FileAccess][];
	outcome?: ImportOutcome;
	publishRoute: PublishingChoice["route"] | null;
	toPublish: string[] | null;
};

/** A saved list of pairs as a map; one a browser saved before it was kept, empty. */
const mapOf = <Value,>(pairs: [string, Value][] | undefined) => new Map(pairs);
const listsOf = <Value,>(sets: ReadonlyMap<string, ReadonlySet<Value>>) => [...sets].map(([id, values]): [string, Value[]] => [id, [...values]]);
const setsOf = <Value,>(lists: [string, Value[]][]) => new Map(lists.map(([id, values]) => [id, new Set(values)]));

function saveChoices(batch: ImportBatch) {
	const saved: SavedChoices = {
		applied: listsOf(batch.applied),
		publish: [...batch.publish].filter(([, { state }]) => state !== "sending"),
		chosen: { collections: listsOf(batch.chosen.collections), topics: listsOf(batch.chosen.topics) },
		collections: batch.collections,
		excluded: [...batch.excluded],
		importId: batch.importId,
		licences: [...batch.licences],
		fileAccesses: [...batch.fileAccesses],
		outcome: batch.outcome,
		publishRoute: batch.publishRoute,
		toPublish: batch.toPublish && [...batch.toPublish],
	};
	try {
		window.localStorage.setItem(CHOICES_KEY, JSON.stringify(saved));
	} catch {
		// Storage that is full or turned off keeps the choices for this page only.
	}
}

/** The choices this browser kept for the import, or none. */
function savedChoices(importId: string): Partial<ImportBatch> {
	try {
		const saved = JSON.parse(window.localStorage.getItem(CHOICES_KEY) ?? "null") as SavedChoices | null;
		if (saved?.importId !== importId) return {};
		return { applied: setsOf(saved.applied), publish: new Map(saved.publish ?? []), chosen: { collections: setsOf(saved.chosen.collections), topics: setsOf(saved.chosen.topics) }, collections: saved.collections, excluded: new Set(saved.excluded), licences: mapOf(saved.licences), fileAccesses: mapOf(saved.fileAccesses), outcome: saved.outcome ?? "drafts", publishRoute: saved.publishRoute, toPublish: saved.toPublish && new Set(saved.toPublish) };
	} catch {
		// No browser storage while the page is served, or an entry this version can't read.
		return {};
	}
}

/**
 * Sends made in another tab or browser, or by the server, as the server
 * knows them, beside this tab's own. A send this tab has under way, or failed
 * on and can try again, keeps its own state. One the server submitted and
 * then failed to approve is failed, with why, so trying again approves it.
 */
function withSent(publish: ReadonlyMap<string, PublishState>, server: Pick<AdminPdfImport, "send" | "sending" | "sent">) {
	const next = new Map(publish);
	for (const [id, state] of Object.entries(server.sent)) {
		const mine = next.get(id);
		// While the server still sends a draft, the review it submitted is a step on the way, not where the draft ends.
		if (server.sending[id]?.state !== "waiting" && takesServerState(mine, state)) next.set(id, { ...mine, ...(approvalFailed(server, id, mine) ?? { message: undefined, state }) });
	}
	return next;
}

/**
 * A draft the server submitted and then couldn't approve, as failed with why. Only an import that publishes approves,
 * and a draft submitted from here since, as a creator's retry is, stays submitted.
 */
function approvalFailed(server: Pick<AdminPdfImport, "send" | "sending" | "sent">, id: string, mine: PublishState | undefined) {
	const failed = server.send?.action === "publish" && server.sent[id] === "submitted" && server.sending[id]?.state === "failed";
	return failed && mine?.state !== "submitted" ? { message: server.sending[id]!.message ?? undefined, state: "failed" as const } : null;
}

/**
 * Whether the server's word on a draft replaces this browser's: not while it
 * sends the draft, and not over a send that failed here and can be tried
 * again, unless the server says it was published after all.
 */
const takesServerState = (mine: PublishState | undefined, state: "published" | "submitted") => mine?.state !== "sending" && (mine?.state !== "failed" || state === "published");

/** The server's import with the choices this browser made on it, the collections the editor changed in the review among them. */
export function pdfImportBatch(server: AdminPdfImport): ImportBatch {
	// The DOI route starts as the one the server sends the drafts on, where this browser chose none.
	const batch: ImportBatch = { ...blankChoices, publishRoute: server.send?.route ?? null, ...fromServer(server), collections: server.collections, ...savedChoices(server.id), importId: server.id, kind: "pdfs" };
	return { ...batch, publish: withSent(batch.publish, server) };
}

// The PDFs this browser sends for the open import. The tab sending them holds a lock of the same name, so once no tab
// holds it, any of them the server still waits for stopped with the page that sent them.
const UPLOADS = "evidence-library:pdf-import-uploads";

type Sending = { fileIds: string[]; importId: string };

/** Notes the PDFs this browser sends, or clears the note. Storage that is full or turned off leaves a reload mid-upload to the server's wait. */
function noteSending(sending: Sending | null) {
	try {
		if (sending) window.localStorage.setItem(UPLOADS, JSON.stringify(sending));
		else window.localStorage.removeItem(UPLOADS);
	} catch {
		// The upload goes ahead without the note.
	}
}

function noteOfSending(): Sending | null {
	try {
		return JSON.parse(window.localStorage.getItem(UPLOADS) ?? "null") as Sending | null;
	} catch {
		return null;
	}
}

/** Sends an import's PDFs, holding the lock that says this browser is sending them. */
export function sendPdfUploads(importId: string, fileIds: string[], send: () => Promise<unknown>) {
	return navigator.locks.request(UPLOADS, async () => {
		noteSending({ fileIds, importId });
		await send();
		noteSending(null);
	});
}

/**
 * Fails the PDFs this browser was sending that never arrived, once no tab is
 * sending them: a reload or a closed tab stopped their upload. Otherwise
 * they would show as uploading, and hold up the rest of the import, until
 * the server gives up on them. Uploads from another browser wait for that.
 */
async function failStoppedUploads(server: AdminPdfImport) {
	const sending = noteOfSending();
	const stopped = sending?.importId === server.id ? server.files.filter(({ id, state }) => state === "uploading" && sending.fileIds.includes(id)) : [];
	if (!stopped.length) return;
	// While a tab is still sending them the lock is held, and nothing changes.
	const failed = await navigator.locks.request(UPLOADS, { ifAvailable: true }, async (lock) => {
		if (!lock) return false;
		await Promise.all(stopped.map(({ id }) => failAdminPdfImportUpload(id, "The upload stopped when the page closed or reloaded.")));
		noteSending(null);
		return true;
	});
	if (failed) await mutate(PDF_IMPORT_KEY);
}

/** Takes in the server's PDF import, keeping the editor's choices on it. */
function syncPdfImport({ import: server }: AdminPdfImportStatus) {
	if (server) void failStoppedUploads(server).catch((error: unknown) => console.error("Failing the stopped uploads failed", error));
	const answer = JSON.stringify(server);
	if (answer === synced && (server ? pdfs?.importId === server.id : !pdfs)) return;
	synced = answer;
	setSlot("pdfs", server ? (pdfs?.importId === server.id ? { ...pdfs, ...fromServer(server), publish: withSent(pdfs.publish, server) } : pdfImportBatch(server)) : null);
	reportChangedDrafts(server);
}

/** Tells the admin which drafts the server changed since its last answer about the import. */
function reportChangedDrafts(server: AdminPdfImport | null) {
	const changed = changedDrafts(syncedImport, server);
	syncedImport = server;
	if (changed.length) window.dispatchEvent(new CustomEvent<string[]>(IMPORT_DRAFTS_CHANGED_EVENT, { detail: changed }));
}

const settling = (state: PdfImportFileState) => state === "uploading" || state === "waiting" || state === "reading";
/** Whether the server still has drafts of this import to send on. */
export const serverSending = (batch: Pick<ImportBatch, "sending">) => Object.values(batch.sending).some(({ state }) => state === "waiting");

/**
 * The DOI route something under way holds the import's drafts to, or undefined while nothing does: the server's
 * while it sends them, or the route of the review a failed send left pending on a draft made in the library, which
 * trying again approves. A draft imported with its DOI keeps it, so its review holds nothing.
 */
export function heldRoute(batch: Pick<ImportBatch, "publish" | "results" | "reviews" | "send" | "sending">): ImportBatch["publishRoute"] | undefined {
	if (batch.send && serverSending(batch)) return batch.send.route;
	const created = new Set(batch.results?.flatMap(({ id, kind }) => (kind === "created" ? [id] : [])));
	const failed = [...batch.publish].find(([id, { state }]) => state === "failed" && created.has(id) && batch.reviews[id]);
	return failed ? batch.reviews[failed[0]]!.route : undefined;
}

/** The DOI route the import's drafts take: the one held while something is under way, else the one chosen here. */
export function routeOf(batch: Parameters<typeof heldRoute>[0] & Pick<ImportBatch, "publishRoute">) {
	const held = heldRoute(batch);
	return held === undefined ? batch.publishRoute : held;
}

/**
 * Whether the server still works on the import, which stays open until it is done: the import's stored PDFs are
 * what the worker attaches, and it sends the drafts on where the import says so.
 */
export const stillWorking = (batch: ImportBatch) => attaching(batch) || serverSending(batch);

// Imported PDFs the worker is still attaching: those of drafts made from a stored PDF with no outcome yet.
const attaching = (batch: ImportBatch) => Boolean(batch.results?.some(({ id, outcome }) => outcome === "created" && !batch.attach.has(id) && batch.rows.some((row) => row.id === id && row.source?.url)));
/**
 * How often to ask the server about the PDF import: every two seconds while its PDFs upload, are read or are
 * attached. Otherwise it is read when it changes, so an import someone else starts or closes shows here too.
 */
const pollEvery = () => (pdfs && (pdfs.rows.some(({ state }) => settling(state)) || attaching(pdfs) || serverSending(pdfs)) ? 2_000 : 0);

/** The library's PDF import from the server, checked while it is open. */
export function usePdfImportStatus() {
	// SWR restarts its timer whenever this option changes, so it is a number that changes only when reading starts or
	// stops. A function would be a new one on every render, and the sheet renders more often than it polls.
	const refreshInterval = useSyncExternalStore(subscribe, pollEvery, () => 0);
	const status = useSWR(PDF_IMPORT_KEY, getAdminPdfImport, { onSuccess: syncPdfImport, refreshInterval });
	useAdminLive(["import"], () => status.mutate());
	return status;
}

// The DOI or file lookup the open sheet waits for. Closing the sheet drops it, so an answer that comes later never
// takes over whatever the sheet shows when it opens again.
let lookup: symbol | null = null;

export function startLookup() {
	lookup = Symbol("lookup");
	return lookup;
}

export function dropLookup() {
	lookup = null;
}

export const lookupStands = (token: symbol) => lookup === token;

// Imports ended in this tab, which a change arriving late must not bring back.
const ended = new Set<string>();

export function endImportBatch(importId: string) {
	ended.add(importId);
	if (pdfs?.importId === importId) {
		setSlot("pdfs", null);
		window.localStorage.removeItem(CHOICES_KEY);
	}
	if (other?.importId === importId) setSlot("other", null);
}

/**
 * Changes an import, unless it ended or another replaced it since the change
 * began. Until the server's first answer is taken in, the library's PDF
 * import is the one given, as the page was served with it.
 */
export function changeImportBatch(batch: ImportBatch, change: (current: ImportBatch) => ImportBatch) {
	const library = pdfs ?? (batch.kind === "pdfs" && !ended.has(batch.importId) ? batch : null);
	if (library?.importId === batch.importId) {
		setSlot("pdfs", change(library));
		saveChoices(pdfs!);
	} else if (other?.importId === batch.importId) setSlot("other", change(other));
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The open imports: the library's PDF import and this tab's DOI or bibliography import. */
export function useImportBatches() {
	const storedPdfs = useSyncExternalStore(subscribe, () => pdfs, () => null);
	const storedOther = useSyncExternalStore(subscribe, () => other, () => null);
	const served = usePdfImportStatus().data?.import;
	// Until the first answer is taken in, the PDF import as the page was served, so nothing changes size once it loads.
	return { other: storedOther, pdfs: storedPdfs ?? (served ? pdfImportBatch(served) : null) };
}

/** The import the toolbar shows: a DOI or bibliography import in hand, else the PDF import. */
export function useImportBatch() {
	const { other: inHand, pdfs: library } = useImportBatches();
	return inHand ?? library;
}

/** The toolbar's Import button: how far the reading is while the dialog is closed, and that a review waits after. A batch holds the button at one width so the count doesn't move the toolbar. */
export function importButtonLabel(current: ImportBatch | null) {
	if (!current) return { batch: false, reading: false, text: "Import Item" };
	if (current.results) return { batch: true, reading: false, text: "Finish import" };
	const { done, total } = reviewCounts(current);
	return { batch: true, reading: done < total, text: done < total ? `Reading ${done} of ${total}` : "Review import" };
}

export type ReviewFilter = "all" | "attention" | "existing" | "improve" | "ready";

/** The suggestions a record has applied: the AI's choice until the editor changes it. */
export function appliedOf(current: ImportBatch | null, row: ImportRow): ReadonlySet<number> {
	return current?.applied.get(row.id) ?? new Set(row.suggestions.flatMap(({ apply }, index) => (apply ? [index] : [])));
}

/** A check passes when it was found met or the editor applied a suggestion that meets it. */
export const checkPasses = (check: ReviewCheck) => check.result === "met" || check.fixed;
export const rowPasses = (row: ImportRow, applied: ReadonlySet<number>) => reviewChecks(row, applied).every(checkPasses);

const needsAttention = (row: ImportRow) =>
	row.state === "failed" || row.record?.state === "attention" || row.record?.state === "unresolved";

function reviewMatches(current: ImportBatch | null, row: ImportRow, filter: ReviewFilter) {
	if (filter === "ready") return row.record?.state === "ready";
	if (filter === "existing") return row.record?.state === "existing" || row.record?.state === "repeated";
	if (filter === "attention") return needsAttention(row);
	if (filter === "improve") return !rowPasses(row, appliedOf(current, row));
	return true;
}

export function reviewCounts(current: ImportBatch | null) {
	const rows = current?.rows ?? [];
	const count = (filter: ReviewFilter) => rows.filter((row) => reviewMatches(current, row, filter)).length;
	return {
		attention: count("attention"),
		done: rows.filter(({ state }) => state === "read" || state === "failed").length,
		existing: count("existing"),
		improve: count("improve"),
		ready: count("ready"),
		total: rows.length,
	};
}

export const readyIds = (rows: readonly ImportRow[]) => rows.flatMap(({ id, record }) => (record?.state === "ready" ? [id] : []));

function selectedIds(current: ImportBatch) {
	return new Set(readyIds(current.rows).filter((id) => !current.excluded.has(id)));
}

/** The topics and collections the AI chose start chosen; the editor drops the ones that don't fit. */
export function chosenOf(current: ImportBatch, row: ImportRow, kind: ChoiceKind): ReadonlySet<string> {
	return current.chosen[kind].get(row.id) ?? new Set(row[kind].map(({ id }) => id));
}

/** The record as the editor leaves it: what the PDF states, with the applied suggestions and the licence picked. */
export function recordPayload(row: ImportRow, applied: ReadonlySet<number>, licence?: RecordLicence, fileAccess?: FileAccess): Record<string, unknown> {
	const changes = row.suggestions.filter((_, index) => applied.has(index)).map(({ field, value }) => [field, value]);
	return { ...row.record?.payload, ...Object.fromEntries(changes), ...(licence ? { licence } : {}), ...(fileAccess ? { fileAccess } : {}) };
}

/** Who the editor chose may get a record's files, if they changed what its licence gives. */
export const fileAccessOfRow = (current: ImportBatch | null, row: ImportRow) => current?.fileAccesses.get(row.id);

/** The licence the editor picked for a record, if they changed what its PDF named. */
export const licenceOf = (current: ImportBatch | null, row: ImportRow) => current?.licences.get(row.id);

/**
 * What a ready record still needs to publish, in the record editor's words. The DOI route is chosen after importing, so
 * a PDF without a DOI, which takes the library's, is held to what Zenodo needs: both routes register through it. One
 * with its own DOI keeps it. The record still imports as a draft, to be completed in the editor.
 */
export function readingNeeds(row: ImportRow, applied: ReadonlySet<number>, route: ImportBatch["publishRoute"] | "later" = "later", licence?: RecordLicence): AdminFieldErrors {
	if (row.record?.state !== "ready") return {};
	const payload = recordPayload(row, applied, licence);
	if (!row.source || keepsDoi(payload)) return publishingNeeds(payload, null);
	// Sent on as it is imported, it is held to the route chosen in the review; chosen later, to Zenodo's.
	return publishingNeeds(payload, routeChoice(route === "later" ? "zenodo" : route));
}

/**
 * The DOI route a review holds its records to: the one chosen to send them on now, or, imported as drafts, Zenodo's, as
 * a DOI may come later. A library without Zenodo registers no DOI, so it holds them to none: no date or licence for one.
 */
export const reviewRoute = (batch: ImportBatch | null, zenodo: boolean): ImportBatch["publishRoute"] | "later" => (batch?.outcome === "send" ? batch.publishRoute : zenodo ? "later" : null);

/** Whether a record keeps a DOI of its own, decided as importing decides it: only a DOI that reads as one counts. */
const keepsDoi = (payload: Record<string, unknown>) => typeof payload.DOI === "string" && Boolean(normalizeDoi(payload.DOI));


/** What an imported draft still needs to publish on the route it takes: the import's for a draft made here, none for one that kept its DOI. */
export function draftNeeds(needs: AdminPdfImport["needs"], publishRoute: ImportBatch["publishRoute"], id: string, kind: "created" | "imported" | undefined): AdminFieldErrors {
	const route = kind === "created" ? (publishRoute ?? "none") : "none";
	return needs[id]?.[route] ?? {};
}

/** What publishing writes into the PDF: the record as the editor leaves it. */
export function publishedProperties(row: ImportRow, applied: ReadonlySet<number>, topicNames: readonly string[]): PdfProperties {
	return pdfPropertiesOfRecord(recordPayload(row, applied), { authors: row.record?.creators ?? [], doi: "", keywords: [...topicNames] });
}

/** A check's answer, and whether an applied suggestion meets it. */
export type ReviewCheck = PdfCheckResult & { fixable: boolean; fixed: boolean };

/** The library's checks as the AI answered them, each marked when a suggestion would meet it. */
export function reviewChecks(row: { checks: readonly PdfCheckResult[]; suggestions: readonly { checks: number[] }[] }, applied: ReadonlySet<number>): ReviewCheck[] {
	return row.checks.map((check, index) => {
		const meeting = row.suggestions.flatMap((suggestion, place) => (suggestion.checks.includes(index) ? [place] : []));
		return { ...check, fixable: meeting.length > 0, fixed: meeting.some((place) => applied.has(place)) };
	});
}

/** A field's value as the record stores it: saving normalises some, such as a URL, which gains its trailing slash. */
function stored(itemType: unknown, field: string, value: string) {
	// A saved record names its type as the library does ("Report"); Zotero's field list is by its own name ("report").
	const descriptor = describeZoteroItemTypeFields(canonicalItemTypeToZotero(itemType)).find((described) => described.field === field);
	return descriptor ? normalizeAdminFieldValue(descriptor, value, { keepUnparsed: true }).value : value.trim();
}

const holds = (payload: Record<string, unknown>, field: string, suggested: string) => {
	const value = payload[field];
	return typeof value === "string" && stored(payload.itemType, field, value) === stored(payload.itemType, field, suggested);
};

/** A record's kept checks, a failed one counted as met while the record holds the change the AI suggested for it. */
export function heldChecks(kept: { checks: readonly PdfCheckResult[]; suggestions: readonly { checks: number[]; field: string; value: string }[] }, payload: Record<string, unknown>): ReviewCheck[] {
	return reviewChecks(kept, new Set(kept.suggestions.flatMap(({ field, value }, index) => (holds(payload, field, value) ? [index] : []))));
}

/** A path without a level that repeats the one above it ("Social Sciences" as both domain and field). */
export function topicPath(path: readonly string[]) {
	return path.filter((name, index) => name !== path[index - 1]);
}

export function errorMessage(error: unknown) {
	if (error instanceof AdminApiError) {
		const fieldMessages = Object.values(error.fields);
		return fieldMessages.length ? `${error.message} ${fieldMessages.join(" ")}` : error.message;
	}
	return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
/** "Read 5 PDFs", or "Read PDFs" before there are any. */
export const action = (verb: string, count: number, one: string, many: string) => (count ? `${verb} ${plural(count, one, many)}` : `${verb} ${many}`);

/**
 * The import the sheet shows: a DOI or bibliography import in hand, else the
 * PDF import, unless the editor stepped out of its review to add another.
 * `openPdfs` is the PDF import while it waits to be imported.
 */
export function shownImport({ other, pdfs: library }: { other: ImportBatch | null; pdfs: ImportBatch | null }, besidePdfs: boolean) {
	const openPdfs = library && !library.results ? library : null;
	return { batch: other ?? (besidePdfs && openPdfs ? null : library), openPdfs };
}

/** Where the sheet is: adding, reviewing an import, or finished with it. */
export function stageOf(batch: ImportBatch | null): ImportStage {
	if (batch?.results) return "done";
	return batch ? "review" : "input";
}

/** The review's rows: all of them, those the filter shows, and the one open. */
export function reviewRows(batch: ImportBatch | null, filter: ReviewFilter, activeId: string | null) {
	const rows = batch?.rows ?? [];
	const shown = rows.filter((row) => reviewMatches(batch, row, filter));
	return { activeRow: rows.find(({ id }) => id === activeId) ?? shown[0] ?? null, rows, shown };
}

/** How the review stands: the counts, whether PDFs are still read, each record's result and the ticked ones. */
export function reviewProgress(batch: ImportBatch | null) {
	const counts = reviewCounts(batch);
	return {
		checkCount: batch?.checks.length ?? 0,
		counts,
		reading: batch?.kind === "pdfs" && counts.done < counts.total,
		resultById: new Map((batch?.results ?? []).map((result) => [result.id, result])),
		selected: batch ? selectedIds(batch) : new Set<string>(),
	};
}

/** What the Add step has in it. */
export type AddInputs = { checks: readonly string[]; doiText: string; files: readonly File[]; guidance: string; pdfs: readonly File[] };

/** The checks a new import starts from: the editor's, else those of the library's last import. */
export const startingChecks = (edited: string[] | null, last: { checks: string[] } | undefined) => edited ?? last?.checks ?? [];

/** The instructions a new import starts from, a line each: the editor's, else those of the library's last import. */
export const startingInstructions = (edited: string[] | null, last: { instructions: string } | undefined) => edited ?? (last?.instructions ?? "").split("\n").filter((line) => line.trim());

/** What stops the Add step's input going ahead, or null when nothing does. */
function inputError(kind: ImportKind, { checks, doiText, files, guidance, pdfs }: AddInputs) {
	try {
		if (kind === "dois") doiPreviewRequest(doiText);
		else if (kind === "files") validateImportFiles(files);
		else {
			validatePdfFiles(pdfs);
			validateChecks(checks);
			validateGuidance(guidance);
		}
		return null;
	} catch (error) {
		return errorMessage(error);
	}
}

// Whether the Add step has something in it. The DOI box lists entries that are not DOIs itself.
function inputGiven(kind: ImportKind, { doiText, files, pdfs }: AddInputs) {
	if (kind === "pdfs") return pdfs.length > 0;
	if (kind === "files") return files.length > 0;
	return Boolean(doiText.trim()) && !parseDoiList(doiText).invalid.length;
}

/**
 * The Add step's state: whether the PDFs tab leads back to an open PDF
 * import rather than reading more, which files it takes by drop or upload,
 * what stops it, and what the footer explains, such as too many DOIs.
 */
export function addStep(kind: ImportKind, openPdfs: ImportBatch | null, inputs: AddInputs, stage: ImportStage) {
	const pdfsWaiting = kind === "pdfs" && openPdfs !== null;
	const problem = pdfsWaiting ? null : inputError(kind, inputs);
	return { fileKind: kind === "dois" || pdfsWaiting ? null : kind, footerProblem: stage === "input" && inputGiven(kind, inputs) ? problem : null, pdfsWaiting, problem };
}

/** The Add step's main button: what it does to how many. */
export function primaryLabel(kind: ImportKind, { doiText, files, pdfs }: AddInputs, openPdfs: ImportBatch | null) {
	if (kind === "dois") return action("Look up", parseDoiList(doiText).dois.length, "DOI", "DOIs");
	if (kind === "files") return action("Read", files.length, "file", "files");
	return openPdfs ? action("Review", openPdfs.rows.length, "PDF", "PDFs") : action("Read", pdfs.length, "PDF", "PDFs");
}

/** The chosen records as they're imported: with the editor's changes and choices, and topics only where the library uses them. */
export function recordsToCommit(batch: ImportBatch, topicsEnabled: boolean) {
	const rowById = new Map(batch.rows.map((row) => [row.id, row]));
	return selectedImportRecords(batch.rows.flatMap(({ record }) => (record ? [record] : [])), selectedIds(batch)).map((record) => {
		const row = rowById.get(record.id)!;
		const topics = [...chosenOf(batch, row, "topics")];
		return { ...record, payload: { ...recordPayload(row, appliedOf(batch, row), licenceOf(batch, row), fileAccessOfRow(batch, row)), collections: [...chosenOf(batch, row, "collections")], ...(topicsEnabled && topics.length ? { topics } : {}) } };
	});
}

function toggled<Value>(values: ReadonlySet<Value>, value: Value) {
	const next = new Set(values);
	if (next.has(value)) next.delete(value);
	else next.add(value);
	return next;
}

/** The import with one suggestion applied or undone. */
export function withSuggestionToggled(current: ImportBatch, rowId: string, index: number): ImportBatch {
	const row = current.rows.find(({ id }) => id === rowId);
	return row ? { ...current, applied: new Map(current.applied).set(rowId, toggled(appliedOf(current, row), index)) } : current;
}

/** The import with one of the AI's topics or collections kept or dropped. */
export function withChoiceToggled(current: ImportBatch, rowId: string, kind: ChoiceKind, id: string): ImportBatch {
	const row = current.rows.find(({ id: candidate }) => candidate === rowId);
	return row ? { ...current, chosen: { ...current.chosen, [kind]: new Map(current.chosen[kind]).set(rowId, toggled(chosenOf(current, row, kind), id)) } } : current;
}

/** What the open import sets for the sheet: its id, its collections, whether it is being imported, and its ready records. */
export function batchFields(batch: ImportBatch | null, collections: string[], busy: boolean) {
	return { collections: batch?.collections ?? collections, importId: batch?.importId ?? "", locked: busy || batch?.committing === true, readyIds: readyIds(batch?.rows ?? []) };
}
