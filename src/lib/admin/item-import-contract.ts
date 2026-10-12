import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { z } from "zod";

import { normalizeDoi } from "@/lib/doi";

import type { AdminFieldErrors } from "./errors";

export const ADMIN_IMPORT_MAX_RECORDS = 500;
export const ADMIN_IMPORT_MAX_FILES = 20;
export const ADMIN_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ADMIN_IMPORT_FILE_FORMATS = [
	"RIS",
	"BibTeX",
	"BibLaTeX",
	"CSL JSON",
	"EndNote XML",
	"MODS",
	"MARCXML",
	"NBIB",
] as const;
export const ADMIN_IMPORT_FILE_EXTENSIONS =
	".ris,.bib,.bibtex,.json,.xml,.nbib,.mods,.txt";

const canonicalKeySchema = z.string().refine(isCanonicalRecordKey, {
	message: "Choose an available collection.",
});

const importFileSchema = z.object({
	content: z
		.string()
		.min(1, "The file is empty.")
		.max(ADMIN_IMPORT_MAX_FILE_BYTES, "Each file must be 5 MB or smaller."),
	name: z.string().min(1).max(255),
});

const adminImportPreviewRequestSchema = z
	.object({
		action: z.literal("preview"),
		dois: z.array(z.string().max(512)).max(ADMIN_IMPORT_MAX_RECORDS).default([]),
		files: z.array(importFileSchema).max(ADMIN_IMPORT_MAX_FILES).default([]),
	})
	.refine((input) => input.dois.length + input.files.length > 0, {
		message: "Add at least one DOI or file.",
		path: ["_form"],
	});

const adminImportCommitRequestSchema = z.object({
	action: z.literal("commit"),
	collections: z.array(canonicalKeySchema).max(50).default([]),
	/** Chosen once per preview; ties a retry to the preview it came from. */
	importId: z.string().uuid(),
	records: z
		.array(
			z.object({
				id: z.string().min(1).max(32),
				method: z.enum(["doi", "file"]),
				payload: z.record(z.string(), z.unknown()),
			}),
		)
		.min(1, "Select at least one record.")
		.max(
			ADMIN_IMPORT_MAX_RECORDS,
			`Import no more than ${ADMIN_IMPORT_MAX_RECORDS} records at once.`,
		)
		.refine((records) => new Set(records.map(({ id }) => id)).size === records.length, {
			message: "Each record must be unique.",
		}),
});

export const adminImportRequestSchema = z.discriminatedUnion("action", [
	adminImportPreviewRequestSchema,
	adminImportCommitRequestSchema,
]);

export type AdminImportRequest = z.infer<typeof adminImportRequestSchema>;
export type AdminImportPreviewRequest = z.infer<
	typeof adminImportPreviewRequestSchema
>;
export type AdminImportCommitRequest = z.infer<
	typeof adminImportCommitRequestSchema
>;

export type AdminImportRecordState =
	| "ready"
	| "existing"
	| "repeated"
	| "attention"
	| "unresolved";

export const ADMIN_IMPORT_STATE_LABELS: Record<AdminImportRecordState, string> = {
	attention: "Needs attention",
	existing: "Already in library",
	ready: "Ready",
	repeated: "Repeated in import",
	unresolved: "Could not resolve",
};

export type AdminImportPreviewRecord = {
	creators: string[];
	/** The key of the record already in the library, for `existing`. */
	existingKey?: string;
	fields?: AdminFieldErrors;
	id: string;
	itemType: string | null;
	method: "doi" | "file";
	message?: string;
	/** Validated draft payload, present only when the record is `ready`. */
	payload: Record<string, unknown> | null;
	/** The DOI or the filename this record came from. */
	source: string;
	state: AdminImportRecordState;
	title: string | null;
	year: number | null;
};

export type AdminImportPreviewResponse = {
	records: AdminImportPreviewRecord[];
};

export const PDF_IMPORT_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const PDF_IMPORT_MAX_CRITERIA = 20;
export const PDF_IMPORT_MAX_CRITERION_LENGTH = 300;

export type PdfCheckResult = {
	criterion: string;
	page: number | null;
	quote: string | null;
	recommendation: string | null;
	result: "met" | "not_met" | "unclear";
};

export type AdminPdfReadResponse = {
	checks: PdfCheckResult[];
	costUsd: number | null;
	inputTokens: number | null;
	ms: number;
	outputTokens: number | null;
	record: AdminImportPreviewRecord;
};

/** One check per line; blank lines are dropped. */
export function parseCriteria(text: string) {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

export type AdminImportCommitResult = {
	existingKey?: string;
	fields?: AdminFieldErrors;
	id: string;
	itemKey?: string;
	message?: string;
	outcome: "created" | "failed" | "skipped";
};

export type AdminImportCommitResponse = {
	results: AdminImportCommitResult[];
};

/** Splits pasted text into normalized DOIs and the entries that are not DOIs. */
export function parseDoiList(text: string) {
	const dois: string[] = [];
	const invalid: string[] = [];
	for (const entry of text.split(/[\s,]+/u)) {
		if (!entry) continue;
		const doi = normalizeDoi(entry);
		if (doi) dois.push(doi);
		else invalid.push(entry);
	}
	return { dois: [...new Set(dois)], invalid };
}
