import { useSyncExternalStore } from "react";

import {
	PDF_IMPORT_MAX_CRITERIA,
	PDF_IMPORT_MAX_CRITERION_LENGTH,
	PDF_IMPORT_MAX_FILE_BYTES,
	type PdfCheckResult,
	type TopicSuggestion,
	ADMIN_IMPORT_MAX_FILE_BYTES,
	ADMIN_IMPORT_MAX_FILES,
	ADMIN_IMPORT_MAX_RECORDS,
	parseDoiList,
	type AdminImportCommitResult,
	type AdminImportPreviewRecord,
	type AdminImportPreviewRequest,
	type AdminPdfReadResponse,
} from "@/lib/admin/item-import-contract";
import type { PdfProperties, PdfPropertiesReading } from "@/lib/admin/pdf-properties";

import type { ImportKind } from "./ImportSteps";


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

export function summarizeImportResults(
	results: readonly AdminImportCommitResult[],
) {
	const createdKeys = results.flatMap(({ itemKey, outcome }) =>
		outcome === "created" && itemKey ? [itemKey] : [],
	);
	const failed = results.filter(({ outcome }) => outcome === "failed").length;
	const drafts = createdKeys.length === 1 ? "draft" : "drafts";
	return {
		createdKeys,
		failed,
		message: failed
			? `${createdKeys.length} ${drafts} created, ${failed} failed`
			: `${createdKeys.length} ${drafts} created`,
	};
}

/** A check the library runs on every PDF, and the Rights text its Fix button writes when it fails. Empty fix: no button. */
export type ImportCheck = { fix: string; text: string };

/** One record in the review, from a DOI, a bibliography file or a PDF the AI reads. */
export type ImportRow = {
	abstractWritten: boolean;
	checks: PdfCheckResult[];
	costUsd: number;
	/** The PDF this row reads; null for DOIs and bibliography files. */
	file: File | null;
	/** The checks the editor fixed, by their place in the list. */
	fixed: number[];
	/** The row's id, also the id its record is committed under. */
	id: string;
	message?: string;
	pdf: PdfPropertiesReading | null;
	record: AdminImportPreviewRecord | null;
	state: "failed" | "read" | "reading" | "waiting";
	topics: TopicSuggestion[];
};

export const PDF_IMPORT_MAX_FILES = 100;
const PDF_READ_CONCURRENCY = 8;

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

export function validateChecks(checks: readonly ImportCheck[]) {
	if (checks.length > PDF_IMPORT_MAX_CRITERIA) {
		throw new ImportInputError(`Use no more than ${PDF_IMPORT_MAX_CRITERIA} checks.`);
	}
	const long = checks.find(({ fix, text }) => text.length > PDF_IMPORT_MAX_CRITERION_LENGTH || fix.length > PDF_IMPORT_MAX_CRITERION_LENGTH);
	if (long) throw new ImportInputError(`Keep each check and fix under ${PDF_IMPORT_MAX_CRITERION_LENGTH} characters.`);
}

const emptyRow = { abstractWritten: false, checks: [], costUsd: 0, fixed: [], pdf: null, topics: [] };

export function pendingPdfRows(files: readonly File[]): ImportRow[] {
	return files.map((file, index) => ({ ...emptyRow, file, id: String(index + 1), record: null, state: "waiting" }));
}

export function rowsFromRecords(records: readonly AdminImportPreviewRecord[]): ImportRow[] {
	return records.map((record) => ({ ...emptyRow, file: null, id: record.id, record, state: "read" }));
}

export type AttachState = "attaching" | "attached" | "failed";
export type PublishState = { doi: string | null; state: "published" | "publishing" };

/**
 * The import being reviewed. It lives outside the dialog, so closing the
 * dialog leaves the PDFs reading and reopening it shows where they got to.
 */
// shortcut: the mock reads in this tab, so a reload ends the batch; the real
// build reads in the publication worker and the dialog follows its job rows.
export type ImportBatch = {
	attach: ReadonlyMap<string, AttachState>;
	/** The checks the PDFs were read against. */
	checks: readonly ImportCheck[];
	/** Collections the new drafts go into. */
	collections: string[];
	/** The import call is under way, so a reopened dialog can't send it twice. */
	committing: boolean;
	/** Ready records the editor unticked. */
	excluded: ReadonlySet<string>;
	importId: string;
	kind: ImportKind;
	publish: ReadonlyMap<string, PublishState>;
	results: AdminImportCommitResult[] | null;
	rows: ImportRow[];
	/** The drafts ticked for publishing, once the editor changes the default. */
	toPublish: ReadonlySet<string> | null;
	/** Each record's topics, once the editor changes the AI's choice. */
	topics: ReadonlyMap<string, ReadonlySet<string>>;
};

let batch: ImportBatch | null = null;
const listeners = new Set<() => void>();

function setBatch(next: ImportBatch | null) {
	batch = next;
	for (const listener of listeners) listener();
}

export function startImportBatch(start: Pick<ImportBatch, "checks" | "importId" | "kind" | "rows">) {
	setBatch({ ...start, attach: new Map(), collections: [], committing: false, excluded: new Set(), publish: new Map(), results: null, toPublish: null, topics: new Map() });
}

export const currentImportBatch = () => batch;

export function endImportBatch() {
	setBatch(null);
}

/** Changes the batch, unless another one replaced it since the change began. */
export function changeImportBatch(importId: string, change: (current: ImportBatch) => ImportBatch) {
	if (batch?.importId === importId) setBatch(change(batch));
}

export function changeImportRow(importId: string, rowId: string, change: (row: ImportRow) => ImportRow) {
	changeImportBatch(importId, (current) => ({ ...current, rows: current.rows.map((row) => (row.id === rowId ? change(row) : row)) }));
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useImportBatch() {
	return useSyncExternalStore(subscribe, () => batch, () => null);
}

/** The toolbar's Import button: how far the reading is while the dialog is closed, and that a review waits after. A batch holds the button at one width so the count doesn't move the toolbar. */
export function importButtonLabel(current: ImportBatch | null) {
	if (!current || current.results) return { batch: false, reading: false, text: "Import Item" };
	const { done, total } = reviewCounts(current.rows);
	return { batch: true, reading: done < total, text: done < total ? `Reading ${done} of ${total}` : "Review import" };
}

/**
 * Reads every PDF, a few at a time, into the batch. A PDF that fails is
 * marked on its own row; the others carry on. A discarded batch stops.
 */
export async function readPdfs(importId: string, rows: readonly ImportRow[], read: (file: File) => Promise<AdminPdfReadResponse>, errorText: (error: unknown) => string) {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(PDF_READ_CONCURRENCY, rows.length) }, async () => {
			while (next < rows.length && batch?.importId === importId) {
				const row = rows[next++]!;
				changeImportRow(importId, row.id, (current) => ({ ...current, state: "reading" }));
				try {
					const reading = await read(row.file!);
					changeImportRow(importId, row.id, (current) => ({
						...current,
						abstractWritten: reading.abstractWritten,
						checks: reading.checks,
						costUsd: reading.costUsd,
						pdf: reading.pdf,
						record: { ...reading.record, id: row.id },
						state: "read",
						topics: reading.topics,
					}));
				} catch (error) {
					changeImportRow(importId, row.id, (current) => ({ ...current, message: errorText(error), state: "failed" }));
				}
			}
		}),
	);
}

export type ReviewFilter = "all" | "attention" | "existing" | "improve" | "ready";

/** A check passes when the AI found it met or the editor fixed it. */
export const checkPasses = (row: ImportRow, index: number) => row.checks[index]?.result === "met" || row.fixed.includes(index);
export const rowPasses = (row: ImportRow) => row.checks.every((_, index) => checkPasses(row, index));

const needsAttention = (row: ImportRow) =>
	row.state === "failed" || row.record?.state === "attention" || row.record?.state === "unresolved";

export function reviewMatches(row: ImportRow, filter: ReviewFilter) {
	if (filter === "ready") return row.record?.state === "ready";
	if (filter === "existing") return row.record?.state === "existing" || row.record?.state === "repeated";
	if (filter === "attention") return needsAttention(row);
	if (filter === "improve") return !rowPasses(row);
	return true;
}

export function reviewCounts(rows: readonly ImportRow[]) {
	return {
		attention: rows.filter(needsAttention).length,
		done: rows.filter(({ state }) => state === "read" || state === "failed").length,
		existing: rows.filter((row) => reviewMatches(row, "existing")).length,
		improve: rows.filter((row) => !rowPasses(row)).length,
		ready: rows.filter((row) => reviewMatches(row, "ready")).length,
		total: rows.length,
	};
}

export const readyIds = (rows: readonly ImportRow[]) => rows.flatMap(({ id, record }) => (record?.state === "ready" ? [id] : []));

export function selectedIds(current: ImportBatch) {
	return new Set(readyIds(current.rows).filter((id) => !current.excluded.has(id)));
}

/** The strong fits start chosen; the editor adds or drops the rest. */
export function chosenTopics(current: ImportBatch, row: ImportRow): ReadonlySet<string> {
	return current.topics.get(row.id) ?? new Set(row.topics.filter(({ fit }) => fit === "strong").map(({ id }) => id));
}

/**
 * The record's Rights. Until the editor fixes a check it is what the PDF
 * states. After a fix, the checks' fix texts together are the library's
 * statement: a fixed check adds its text, and so does a met one, because the
 * PDF already says it.
 */
export function recordRights(row: ImportRow, checks: readonly ImportCheck[]) {
	const stated = typeof row.record?.payload?.rights === "string" ? row.record.payload.rights : "";
	if (!row.fixed.length) return stated;
	return checks.flatMap(({ fix }, index) => (fix && checkPasses(row, index) ? [fix] : [])).join(". ");
}

/** What publishing writes into the PDF: the record as the editor leaves it. */
export function publishedProperties(row: ImportRow, checks: readonly ImportCheck[], topicNames: readonly string[], doi: string | null): PdfProperties {
	const text = (field: string) => (typeof row.record?.payload?.[field] === "string" ? (row.record.payload[field] as string) : "");
	return {
		authors: row.record?.creators ?? [],
		doi: doi ?? text("DOI"),
		keywords: [...topicNames],
		rights: recordRights(row, checks),
		subject: text("abstractNote"),
		title: row.record?.title ?? "",
	};
}

export type ReviewCheck = PdfCheckResult & { fix: string; fixed: boolean };

export function reviewChecks(row: ImportRow, checks: readonly ImportCheck[]): ReviewCheck[] {
	return row.checks.map((check, index) => ({ ...check, fix: checks[index]?.fix ?? "", fixed: row.fixed.includes(index) }));
}

// shortcut: the mock keeps the library's checks and each draft's results in
// this browser; the real build stores both in the library's database.
const CHECKS_KEY = "evidence-library:pdf-import-check-list";
const RESULTS_KEY = "evidence-library:pdf-import-results:";
// shortcut: placeholder wording for the FCDO demo until Jenny's checklist arrives.
const DEFAULT_CHECKS: ImportCheck[] = [
	{ fix: "", text: "Credits UK International Development (FCDO) or UK aid as the funder" },
	{ fix: "© Crown copyright", text: "Carries a Crown copyright notice" },
	{ fix: "Licensed under the Open Government Licence v3.0", text: "Is licensed under the Open Government Licence v3.0" },
	{ fix: "", text: "The figures in its tables add up to the totals it states" },
];

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

const isCheck = (value: unknown): value is ImportCheck =>
	typeof (value as ImportCheck | null)?.text === "string" && typeof (value as ImportCheck).fix === "string";

/** The checks saved in this browser, or the defaults when none are. */
export function checksFrom(stored: string | null): ImportCheck[] {
	const parsed = stored === null ? null : parseJson(stored);
	return Array.isArray(parsed) && parsed.every(isCheck) ? parsed : DEFAULT_CHECKS;
}

export function storedChecks() {
	return checksFrom(localStorage.getItem(CHECKS_KEY));
}

export function storeChecks(checks: readonly ImportCheck[]) {
	localStorage.setItem(CHECKS_KEY, JSON.stringify(checks));
}

export type StoredReview = { abstractWritten: boolean; checks: ReviewCheck[]; topics: TopicSuggestion[] };

/** The saved review as text, so a store snapshot compares equal between reads. */
export function storedReview(itemKey: string) {
	return localStorage.getItem(RESULTS_KEY + itemKey);
}

/** A draft's saved review. Reviews saved by earlier mocks lack fixes; anything unreadable reads as none. */
export function reviewFrom(stored: string): StoredReview | null {
	const review = parseJson(stored) as Partial<StoredReview> | null | undefined;
	if (!Array.isArray(review?.checks) || !Array.isArray(review?.topics)) return null;
	return {
		abstractWritten: review.abstractWritten === true,
		checks: review.checks.map((check) => ({ ...check, fix: check.fix ?? "", fixed: check.fixed === true })),
		topics: review.topics,
	};
}

// shortcut: the mock pretends to publish and to get a DOI from the Zenodo
// sandbox; the real build sets each record's publishing choice, approves it
// and lets the publication worker allocate the DOI.
export async function publishImported(importId: string, ids: readonly string[]) {
	const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
	const mark = (id: string, state: PublishState) => changeImportBatch(importId, (current) => ({ ...current, publish: new Map(current.publish).set(id, state) }));
	for (const id of ids) mark(id, { doi: null, state: "publishing" });
	let next = 0;
	await Promise.all(
		Array.from({ length: 2 }, async () => {
			while (next < ids.length) {
				const id = ids[next++]!;
				await wait(900 + Math.random() * 900);
				mark(id, { doi: `10.5072/zenodo.${Math.floor(1_000_000 + Math.random() * 9_000_000)}`, state: "published" });
			}
		}),
	);
}

export function storeReview(itemKey: string, review: StoredReview) {
	if (review.checks.length || review.topics.length || review.abstractWritten) localStorage.setItem(RESULTS_KEY + itemKey, JSON.stringify(review));
}

/** A path without a level that repeats the one above it ("Social Sciences" as both domain and field). */
export function topicPath(path: readonly string[]) {
	return path.filter((name, index) => name !== path[index - 1]);
}
