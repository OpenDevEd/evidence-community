import {
	PDF_IMPORT_MAX_CRITERIA,
	PDF_IMPORT_MAX_CRITERION_LENGTH,
	PDF_IMPORT_MAX_FILE_BYTES,
	parseCriteria,
	type PdfCheckResult,
	ADMIN_IMPORT_MAX_FILE_BYTES,
	ADMIN_IMPORT_MAX_FILES,
	ADMIN_IMPORT_MAX_RECORDS,
	ADMIN_IMPORT_STATE_LABELS,
	parseDoiList,
	type AdminImportCommitResult,
	type AdminImportPreviewRecord,
	type AdminImportPreviewRequest,
} from "@/lib/admin/item-import-contract";

import { humanizeAdminField } from "./admin-schema";

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

export function readyImportIds(records: readonly AdminImportPreviewRecord[]) {
	return records.filter(({ state }) => state === "ready").map(({ id }) => id);
}

export function toggleImportSelection(
	current: ReadonlySet<string>,
	id: string,
	selected: boolean,
) {
	const next = new Set(current);
	if (selected) next.add(id);
	else next.delete(id);
	return next;
}

export function selectedImportRecords(
	records: readonly AdminImportPreviewRecord[],
	selected: ReadonlySet<string>,
) {
	return records.flatMap(({ id, method, payload }) =>
		selected.has(id) && payload ? [{ id, method, payload }] : [],
	);
}

export function importRowCells(record: AdminImportPreviewRecord) {
	return {
		creators: record.creators.join("; "),
		itemType: record.itemType ? humanizeAdminField(record.itemType) : "",
		/** Accessible name for the row checkbox. */
		label: `Import ${record.title ?? record.source}`,
		selectable: record.state === "ready",
		title: record.title,
		year: record.year === null ? "" : String(record.year),
	};
}

export function importStage(
	preview: unknown,
	results: unknown,
): "done" | "input" | "preview" {
	if (results) return "done";
	return preview ? "preview" : "input";
}

export function importRowStatus(
	record: AdminImportPreviewRecord,
	result: AdminImportCommitResult | undefined,
) {
	if (!result) {
		return {
			detail: record.message ?? null,
			label: ADMIN_IMPORT_STATE_LABELS[record.state],
			tone: record.state,
		};
	}
	return {
		detail: null,
		label: result.outcome === "created" ? "Draft created" : result.message ?? "Failed",
		tone: result.outcome === "created" ? ("ready" as const) : ("attention" as const),
	};
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

export type PdfRead = {
	checks: PdfCheckResult[];
	file: File;
	/** The row's id, also the id its record is committed under. */
	id: string;
	message?: string;
	record: AdminImportPreviewRecord | null;
	state: "failed" | "read" | "reading" | "waiting";
};

const PDF_IMPORT_MAX_FILES = 100;
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

export function validateCriteria(text: string) {
	const criteria = parseCriteria(text);
	if (criteria.length > PDF_IMPORT_MAX_CRITERIA) {
		throw new ImportInputError(`Use no more than ${PDF_IMPORT_MAX_CRITERIA} checks.`);
	}
	const long = criteria.find((criterion) => criterion.length > PDF_IMPORT_MAX_CRITERION_LENGTH);
	if (long) throw new ImportInputError(`Keep each check under ${PDF_IMPORT_MAX_CRITERION_LENGTH} characters.`);
	return criteria;
}

export function pendingPdfReads(files: readonly File[]): PdfRead[] {
	return files.map((file, index) => ({ checks: [], file, id: String(index + 1), record: null, state: "waiting" }));
}

/**
 * Reads every PDF, a few at a time, and reports each row as it changes. A
 * PDF that fails is marked on its own row; the others carry on.
 */
export async function readPdfs(
	reads: readonly PdfRead[],
	read: (file: File) => Promise<{ checks: PdfCheckResult[]; record: AdminImportPreviewRecord }>,
	onChange: (row: PdfRead) => void,
	errorText: (error: unknown) => string,
) {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(PDF_READ_CONCURRENCY, reads.length) }, async () => {
			while (next < reads.length) {
				const row = reads[next++]!;
				onChange({ ...row, state: "reading" });
				try {
					const { checks, record } = await read(row.file);
					onChange({ ...row, checks, record: { ...record, id: row.id }, state: "read" });
				} catch (error) {
					onChange({ ...row, message: errorText(error), state: "failed" });
				}
			}
		}),
	);
}

// shortcut: the mock keeps the library's checks and each draft's results in
// this browser; the real build stores both in the library's database.
const CRITERIA_KEY = "evidence-library:pdf-import-checks";
const RESULTS_KEY = "evidence-library:pdf-import-results:";
const DEFAULT_CRITERIA = "Names the funder of the work\nStates a licence for reuse, such as Creative Commons\nHas an abstract or executive summary";

export function storedCriteria() {
	return localStorage.getItem(CRITERIA_KEY) ?? DEFAULT_CRITERIA;
}

export function storeCriteria(text: string) {
	localStorage.setItem(CRITERIA_KEY, text);
}

/** The saved results as text, so a store snapshot compares equal between reads. */
export function storedCheckResults(itemKey: string) {
	return localStorage.getItem(RESULTS_KEY + itemKey);
}

export function storeCheckResults(itemKey: string, checks: PdfCheckResult[]) {
	if (checks.length) localStorage.setItem(RESULTS_KEY + itemKey, JSON.stringify(checks));
}

export const IMPORT_STATE_TONE: Record<AdminImportPreviewRecord["state"], string> = {
	attention: "text-amber-700 dark:text-amber-400",
	existing: "text-black/55 dark:text-white/55",
	ready: "text-emerald-700 dark:text-emerald-400",
	repeated: "text-black/55 dark:text-white/55",
	unresolved: "text-danger",
};
