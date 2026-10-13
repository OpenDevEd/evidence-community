import { useSyncExternalStore } from "react";
import useSWR from "swr";

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
import { pdfPropertiesOfRecord, type PdfProperties, type PdfPropertiesReading } from "@/lib/admin/pdf-properties";
import type { PublishingChoice } from "@/lib/admin/review-contract";

import type { ImportKind } from "./ImportSteps";
import { getAdminPdfImport, PDF_IMPORT_KEY, pdfImportFileUrl } from "./admin-api";


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
			`These entries are not DOIs: ${shown}${invalid.length > 5 ? "…" : ""}`,
		);
	}
	if (!dois.length) throw new ImportInputError("Paste at least one DOI.");
	if (dois.length > ADMIN_IMPORT_MAX_RECORDS) {
		throw new ImportInputError(
			`Import no more than ${ADMIN_IMPORT_MAX_RECORDS} records at once.`,
		);
	}
	return { dois, files: [] };
}

export function validateImportFiles(files: readonly File[]): void {
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


export function validatePdfFiles(files: readonly File[]): void {
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

export function validateChecks(checks: readonly string[]) {
	if (checks.length > PDF_IMPORT_MAX_CRITERIA) {
		throw new ImportInputError(`Use no more than ${PDF_IMPORT_MAX_CRITERIA} checks.`);
	}
	const long = checks.find((check) => check.length > PDF_IMPORT_MAX_CRITERION_LENGTH);
	if (long) throw new ImportInputError(`Keep each check under ${PDF_IMPORT_MAX_CRITERION_LENGTH} characters.`);
}

export function validateGuidance(guidance: string) {
	if (guidance.trim().length > PDF_IMPORT_MAX_GUIDANCE_LENGTH) throw new ImportInputError(`Keep the AI instructions under ${PDF_IMPORT_MAX_GUIDANCE_LENGTH} characters in all.`);
}

const emptyRow = { checks: [], cites: [], collections: [], pdf: null, source: null, suggestions: [], topics: [] };

export function rowsFromRecords(records: readonly AdminImportPreviewRecord[]): ImportRow[] {
	return records.map((record) => ({ ...emptyRow, id: record.id, record, state: "read" }));
}

/** The import's PDFs as review rows, with whatever the worker has read of each. */
function rowsFromImport(server: AdminPdfImport): ImportRow[] {
	return server.files.map((file) => ({
		checks: file.reading?.checks ?? [],
		cites: file.reading?.cites ?? [],
		collections: file.reading?.collections ?? [],
		id: file.rowId,
		message: file.message ?? undefined,
		pdf: file.reading?.pdf ?? null,
		record: file.reading?.record ?? null,
		// No address until the PDF is stored, so a cover isn't drawn from a missing file.
		source: { filename: file.filename, url: file.stored ? pdfImportFileUrl(file.id) : null },
		state: file.state,
		suggestions: file.reading?.suggestions ?? [],
		topics: file.reading?.topics ?? [],
	}));
}

/** Whether importing gave a draft its PDF; the server does it while the drafts are made. */
export type AttachState = "attached" | "failed";
/** A draft sent on from the finish step: published by an editor or owner, or submitted for one, with its reserved Crossref DOI. */
export type PublishState = { doi?: string; message?: string; state: "failed" | "published" | "sending" | "submitted" };

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
	importId: string;
	kind: ImportKind;
	publish: ReadonlyMap<string, PublishState>;
	/** How drafts made from PDFs get their DOI, as on a record made in the library. */
	publishRoute: PublishingChoice["route"];
	results: AdminImportCommitResult[] | null;
	rows: ImportRow[];
	/** The drafts ticked for publishing, once the editor changes the default. */
	toPublish: ReadonlySet<string> | null;
	/** Each record's topics and collections, once the editor changes the AI's choice. */
	chosen: Record<ChoiceKind, ReadonlyMap<string, ReadonlySet<string>>>;
};

/** What the AI chooses from a library's own lists for a record. */
export type ChoiceKind = "collections" | "topics";

let batch: ImportBatch | null = null;
const listeners = new Set<() => void>();

function setBatch(next: ImportBatch | null) {
	batch = next;
	for (const listener of listeners) listener();
}

export function startImportBatch(start: Pick<ImportBatch, "checks" | "collections" | "importId" | "kind" | "rows">) {
	setBatch({ ...start, ...blankChoices, results: null });
}

const blankChoices = { applied: new Map(), attach: new Map(), committing: false, excluded: new Set<string>(), publish: new Map(), publishRoute: "zenodo" as const, toPublish: null, chosen: { collections: new Map(), topics: new Map() } };

/**
 * Takes in the server's PDF import, keeping the editor's choices on it. A
 * DOI or bibliography import under review stays; the PDF import shows once
 * it ends.
 */
// The server's answer last taken in, so a poll that brings nothing new re-renders nothing.
let synced = "";

/** What the server says of its import, as the review takes it. */
function fromServer(server: AdminPdfImport) {
	return { attach: new Map(Object.entries(server.attach)), checks: server.checks, results: server.results, rows: rowsFromImport(server) };
}

/** The server's import with no choices made on it yet. */
const pdfBatch = (server: AdminPdfImport): ImportBatch => ({ ...blankChoices, ...fromServer(server), collections: server.collections, importId: server.id, kind: "pdfs" });

function syncPdfImport({ import: server }: AdminPdfImportStatus) {
	if (batch && batch.kind !== "pdfs") return;
	const answer = JSON.stringify(server);
	if (answer === synced && (server ? batch?.importId === server.id : !batch)) return;
	synced = answer;
	if (!server) {
		if (batch) setBatch(null);
		return;
	}
	setBatch(batch?.importId === server.id ? { ...batch, ...fromServer(server) } : pdfBatch(server));
}

const settling = (state: PdfImportFileState) => state === "uploading" || state === "waiting" || state === "reading";

/** The library's PDF import from the server, checked every few seconds while its PDFs are read. */
export function usePdfImportStatus() {
	return useSWR(PDF_IMPORT_KEY, getAdminPdfImport, {
		onSuccess: syncPdfImport,
		refreshInterval: (status) => (status?.import?.files.some(({ state }) => settling(state)) ? 2_000 : 0),
	});
}

export const currentImportBatch = () => batch;

export function endImportBatch() {
	setBatch(null);
}

/** Changes the batch, unless another one replaced it since the change began. */
export function changeImportBatch(importId: string, change: (current: ImportBatch) => ImportBatch) {
	if (batch?.importId === importId) setBatch(change(batch));
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useImportBatch() {
	const stored = useSyncExternalStore(subscribe, () => batch, () => null);
	const served = usePdfImportStatus().data?.import;
	// Until the first answer is taken in, the import as the page was served, so nothing changes size once it loads.
	return stored ?? (served ? pdfBatch(served) : null);
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

export function reviewMatches(current: ImportBatch | null, row: ImportRow, filter: ReviewFilter) {
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

export function selectedIds(current: ImportBatch) {
	return new Set(readyIds(current.rows).filter((id) => !current.excluded.has(id)));
}

/** The topics and collections the AI chose start chosen; the editor drops the ones that don't fit. */
export function chosenOf(current: ImportBatch, row: ImportRow, kind: ChoiceKind): ReadonlySet<string> {
	return current.chosen[kind].get(row.id) ?? new Set(row[kind].map(({ id }) => id));
}

/** The record as the editor leaves it: what the PDF states, with the applied suggestions. */
export function recordPayload(row: ImportRow, applied: ReadonlySet<number>): Record<string, unknown> {
	const changes = row.suggestions.filter((_, index) => applied.has(index)).map(({ field, value }) => [field, value]);
	return { ...row.record?.payload, ...Object.fromEntries(changes) };
}

/** What publishing writes into the PDF: the record as the editor leaves it. */
export function publishedProperties(row: ImportRow, applied: ReadonlySet<number>, topicNames: readonly string[]): PdfProperties {
	return pdfPropertiesOfRecord(recordPayload(row, applied), { authors: row.record?.creators ?? [], doi: "", keywords: [...topicNames] });
}

/** A check's answer, and whether an applied suggestion meets it. */
export type ReviewCheck = PdfCheckResult & { fixable: boolean; fixed: boolean };

/** The library's checks as the AI answered them, each marked when a suggestion would meet it. */
export function reviewChecks(row: ImportRow, applied: ReadonlySet<number>): ReviewCheck[] {
	return row.checks.map((check, index) => {
		const meeting = row.suggestions.flatMap((suggestion, place) => (suggestion.checks.includes(index) ? [place] : []));
		return { ...check, fixable: meeting.length > 0, fixed: meeting.some((place) => applied.has(place)) };
	});
}

/** A path without a level that repeats the one above it ("Social Sciences" as both domain and field). */
export function topicPath(path: readonly string[]) {
	return path.filter((name, index) => name !== path[index - 1]);
}
