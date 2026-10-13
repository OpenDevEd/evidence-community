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
/** The library's guidance for the AI: free text it follows when it reads each PDF. */
export const PDF_IMPORT_MAX_GUIDANCE_LENGTH = 2000;

export type PdfCheckResult = {
	criterion: string;
	page: number | null;
	quote: string | null;
	recommendation: string | null;
	result: "met" | "not_met" | "unclear";
};

/** An OpenAlex topic the AI judged to fit a PDF, with its domain, field and subfield. */
export type TopicSuggestion = {
	fit: "partial" | "strong";
	id: string;
	name: string;
	path: string[];
	reason: string;
};

/** The Rights statement the AI proposes when checks fail over copyright or licence, and the checks it fixes, by their place in the list. */
export type RightsFix = { checks: number[]; statement: string };

export type AdminPdfReadResponse = {
	/** The PDF had no abstract, so the AI's summary is the record's abstract. */
	abstractWritten: boolean;
	checks: PdfCheckResult[];
	topics: TopicSuggestion[];
	costUsd: number;
	inputTokens: number;
	ms: number;
	outputTokens: number;
	/** The properties the PDF carries now, before publishing writes the record into it. */
	pdf: PdfPropertiesReading;
	record: AdminImportPreviewRecord;
	rightsFix: RightsFix | null;
};

/** OpenRouter's price for Claude Haiku 5.5 per token, checked 2026-10-12. */
const PDF_IMPORT_PRICE = { input: 0.1 / 1_000_000, output: 0.5 / 1_000_000 };

export function pdfImportCost(inputTokens: number, outputTokens: number) {
	return inputTokens * PDF_IMPORT_PRICE.input + outputTokens * PDF_IMPORT_PRICE.output;
}

// Measured on the sample reports: each page costs about 2,000 input tokens;
// the subfield list, the instructions and the topic call add the rest.
const ESTIMATE_TOKENS = { page: 2_000, pdf: 17_000, output: 4_000 };

/** What reading these PDFs should cost, from their page counts. */
export function estimatePdfImportCost(pages: number, pdfs: number) {
	return pdfImportCost(pages * ESTIMATE_TOKENS.page + pdfs * ESTIMATE_TOKENS.pdf, pdfs * ESTIMATE_TOKENS.output);
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
