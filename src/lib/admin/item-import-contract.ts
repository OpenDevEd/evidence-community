import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { z } from "zod";

import { normalizeDoi } from "@/lib/doi";

import type { AdminFieldErrors } from "./errors";
import type { PdfPropertiesReading } from "./pdf-properties";

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
				method: z.enum(["doi", "file", "pdf"]),
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

export type AdminImportPreviewRecord = {
	creators: string[];
	/** The key of the record already in the library, for `existing`. */
	existingKey?: string;
	fields?: AdminFieldErrors;
	id: string;
	itemType: string | null;
	method: "doi" | "file" | "pdf";
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
export const PDF_IMPORT_MAX_FILES = 100;
export const PDF_IMPORT_MAX_CRITERIA = 20;
export const PDF_IMPORT_MAX_CRITERION_LENGTH = 300;
/** The library's instructions for the AI, free text it follows when it reads each PDF. */
export const PDF_IMPORT_MAX_GUIDANCE_LENGTH = 4000;

export type PdfCheckResult = {
	criterion: string;
	page: number | null;
	quote: string | null;
	recommendation: string | null;
	result: "met" | "not_met" | "unclear";
};

/** A topic from the library's catalogue that the AI found fits the PDF. */
export type TopicSuggestion = {
	id: string;
	name: string;
	path: string[];
	reason: string;
};

/**
 * A value the AI suggests a record field should have instead of what the
 * PDF states: to follow the library's instructions, to meet a check, or to
 * fill something the PDF leaves out. `checks` are the checks it makes pass,
 * by their place in the list; `apply` says it starts applied, as the
 * library's instructions call for it.
 */
export type PdfSuggestion = {
	apply: boolean;
	checks: number[];
	field: string;
	reason: string;
	value: string;
};

/** What the AI made of one PDF. */
export type PdfReading = {
	checks: PdfCheckResult[];
	/** The properties the PDF carries now, before publishing writes the record into it. */
	pdf: PdfPropertiesReading;
	record: AdminImportPreviewRecord;
	suggestions: PdfSuggestion[];
	topics: TopicSuggestion[];
};

export type PdfImportFileState = "uploading" | "waiting" | "reading" | "read" | "failed";

/** One PDF of the library's import, as the worker has got with it. */
export type AdminPdfImportFile = {
	filename: string;
	id: string;
	message: string | null;
	/** Its row and record id in the review, from its place in the import. */
	rowId: string;
	/** The PDF is in storage, so the review can show and open it. */
	stored: boolean;
	reading: PdfReading | null;
	state: PdfImportFileState;
};

/** The library's one PDF import: what it reads against, its PDFs, and once imported, what became of each. */
export type AdminPdfImport = {
	attach: Record<string, "attached" | "failed">;
	checks: string[];
	collections: string[];
	createdAt: string;
	files: AdminPdfImportFile[];
	id: string;
	instructions: string;
	results: AdminImportCommitResult[] | null;
};

/** Where the admin keeps the import's status, also filled by the page as it is served. */
export const PDF_IMPORT_KEY = "admin-pdf-import";

export type AdminPdfImportStatus = {
	import: AdminPdfImport | null;
	/** The checks and instructions of the import before, which a new one starts from. */
	last: { checks: string[]; instructions: string };
};


export type AdminImportCommitResult = {
	existingKey?: string;
	fields?: AdminFieldErrors;
	id: string;
	itemKey?: string;
	/** For a created draft: made here, so it publishes with the library's DOI, or imported with its own. */
	kind?: "created" | "imported";
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
