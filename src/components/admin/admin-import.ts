import { useSyncExternalStore } from "react";

import {
	PDF_IMPORT_MAX_CRITERIA,
	PDF_IMPORT_MAX_CRITERION_LENGTH,
	PDF_IMPORT_MAX_FILE_BYTES,
	PDF_IMPORT_MAX_GUIDANCE_LENGTH,
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
	type RightsFix,
} from "@/lib/admin/item-import-contract";
import type { PdfProperties, PdfPropertiesReading } from "@/lib/admin/pdf-properties";
import type { PublishingChoice } from "@/lib/admin/review-contract";

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

/** The drafts an import created, which the table selects. */
export function createdKeys(results: readonly AdminImportCommitResult[]) {
	return results.flatMap(({ itemKey, outcome }) => (outcome === "created" && itemKey ? [itemKey] : []));
}

/** One record in the review, from a DOI, a bibliography file or a PDF the AI reads. */
export type ImportRow = {
	abstractWritten: boolean;
	checks: PdfCheckResult[];
	costUsd: number;
	/** The PDF this row reads; null for DOIs and bibliography files. */
	file: File | null;
	/** The editor applied the AI's Rights fix. */
	fixApplied: boolean;
	/** The row's id, also the id its record is committed under. */
	id: string;
	message?: string;
	pdf: PdfPropertiesReading | null;
	record: AdminImportPreviewRecord | null;
	rightsFix: RightsFix | null;
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

const emptyRow = { abstractWritten: false, checks: [], costUsd: 0, fixApplied: false, pdf: null, rightsFix: null, topics: [] };

export function pendingPdfRows(files: readonly File[]): ImportRow[] {
	return files.map((file, index) => ({ ...emptyRow, file, id: String(index + 1), record: null, state: "waiting" }));
}

export function rowsFromRecords(records: readonly AdminImportPreviewRecord[]): ImportRow[] {
	return records.map((record) => ({ ...emptyRow, file: null, id: record.id, record, state: "read" }));
}

export type AttachState = "attaching" | "attached" | "failed";
export type PublishState = { message?: string; state: "failed" | "published" | "publishing" };

/**
 * The import being reviewed. It lives outside the dialog, so closing the
 * dialog leaves the PDFs reading and reopening it shows where they got to.
 */
// shortcut: the mock reads in this tab, so a reload ends the batch; the real
// build reads in the publication worker and the dialog follows its job rows.
export type ImportBatch = {
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
	/** Each record's topics, once the editor changes the AI's choice. */
	topics: ReadonlyMap<string, ReadonlySet<string>>;
};

let batch: ImportBatch | null = null;
const listeners = new Set<() => void>();

function setBatch(next: ImportBatch | null) {
	batch = next;
	for (const listener of listeners) listener();
}

export function startImportBatch(start: Pick<ImportBatch, "checks" | "collections" | "importId" | "kind" | "rows">) {
	setBatch({ ...start, attach: new Map(), committing: false, excluded: new Set(), publish: new Map(), publishRoute: "zenodo", results: null, toPublish: null, topics: new Map() });
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
						rightsFix: reading.rightsFix,
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

/** A check passes when it was found met or the editor applied the Rights fix that covers it. */
export const checkPasses = (check: ReviewCheck) => check.result === "met" || check.fixed;
export const rowPasses = (row: ImportRow) => reviewChecks(row).every(checkPasses);

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

/** The record's Rights: the AI's fix once the editor applies it, otherwise what the PDF states. */
export function recordRights(row: ImportRow) {
	if (row.fixApplied && row.rightsFix) return row.rightsFix.statement;
	return typeof row.record?.payload?.rights === "string" ? row.record.payload.rights : "";
}

/** What publishing writes into the PDF: the record as the editor leaves it. */
export function publishedProperties(row: ImportRow, topicNames: readonly string[]): PdfProperties {
	const text = (field: string) => (typeof row.record?.payload?.[field] === "string" ? (row.record.payload[field] as string) : "");
	return {
		authors: row.record?.creators ?? [],
		doi: text("DOI"),
		keywords: [...topicNames],
		rights: recordRights(row),
		subject: text("abstractNote"),
		title: row.record?.title ?? "",
	};
}

/**
 * A check's answer, and whether the AI's Rights fix covers it and is applied.
 * A file check is read from the PDF itself; its quote says what the file claims.
 */
export type ReviewCheck = PdfCheckResult & { file: boolean; fixable: boolean; fixed: boolean };

/**
 * Checks every PDF gets beside the library's, from Björn's accessibility
 * guidance: the copy readers download should be tagged to PDF/UA, and PDF/A
 * when it is also the archive deposit, which a published PDF is.
 */
export const FILE_CHECKS = [
	{ criterion: "Tagged for screen readers", met: () => null, recommendation: "Export a tagged PDF from the source file and replace this one. Word and LibreOffice both have the option when saving as PDF.", standard: "tagged" },
	{ criterion: "Claims PDF/UA, the accessibility standard", met: (part: string) => `Its metadata claims PDF/UA-${part}`, recommendation: "Export from the source file with PDF/UA turned on, which LibreOffice offers, or have the PDF remediated.", standard: "pdfua" },
	{ criterion: "Claims PDF/A, the archiving standard", met: (part: string) => `Its metadata claims PDF/A-${part.toLowerCase()}`, recommendation: "Export as PDF/A from the source file so the archived copy opens the same way for decades. Word and LibreOffice both have the option.", standard: "pdfa" },
] as const;

function fileChecks(pdf: PdfPropertiesReading): ReviewCheck[] {
	return FILE_CHECKS.map(({ criterion, met, recommendation, standard }) => {
		const check = { criterion, file: true, fixable: false, fixed: false, page: null };
		// A file with a password or broken structure can't be read for its claims.
		if (!pdf.writable) return { ...check, quote: null, recommendation: null, result: "unclear" };
		const claim = pdf.standards[standard];
		return claim ? { ...check, quote: met(String(claim)), recommendation: null, result: "met" } : { ...check, quote: null, recommendation, result: "not_met" };
	});
}

/** The library's checks as the AI answered them, then the file's own. */
export function reviewChecks(row: ImportRow): ReviewCheck[] {
	const library = row.checks.map((check, index) => {
		const fixable = row.rightsFix?.checks.includes(index) === true;
		return { ...check, file: false, fixable, fixed: fixable && row.fixApplied };
	});
	return row.pdf ? [...library, ...fileChecks(row.pdf)] : library;
}

// shortcut: the mock keeps the library's checks and each draft's results in
// this browser; the real build stores both in the library's database.
const CHECKS_KEY = "evidence-library:pdf-import-check-texts";
const GUIDANCE_KEY = "evidence-library:pdf-import-guidance";
// shortcut: placeholder wording for the FCDO demo until Jenny's checklist arrives.
const DEFAULT_CHECKS = [
	"Credits UK International Development (FCDO) or UK aid as the funder",
	"Carries a Crown copyright notice",
	"Is licensed under the Open Government Licence v3.0",
	"The figures in its tables add up to the totals it states",
];

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** The checks saved in this browser, or the defaults when none are. */
function checksFrom(stored: string | null): string[] {
	const parsed = stored === null ? null : parseJson(stored);
	return Array.isArray(parsed) && parsed.every((check) => typeof check === "string") ? parsed : DEFAULT_CHECKS;
}

export function storedChecks() {
	return checksFrom(localStorage.getItem(CHECKS_KEY));
}

export function storeChecks(checks: readonly string[]) {
	localStorage.setItem(CHECKS_KEY, JSON.stringify(checks));
}

/** The library's guidance for the AI, saved in this browser like the checks. */
export const storedGuidance = () => localStorage.getItem(GUIDANCE_KEY) ?? "";

export function storeGuidance(guidance: string) {
	localStorage.setItem(GUIDANCE_KEY, guidance);
}

/** A path without a level that repeats the one above it ("Social Sciences" as both domain and field). */
export function topicPath(path: readonly string[]) {
	return path.filter((name, index) => name !== path[index - 1]);
}
