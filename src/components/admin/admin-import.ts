import {
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

export async function filePreviewRequest(
	files: readonly File[],
): Promise<ImportPreviewInput> {
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
	return records.flatMap(({ id, payload }) =>
		selected.has(id) && payload ? [{ id, payload }] : [],
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
