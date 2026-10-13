import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import { AdminValidationError } from "@/lib/admin/errors";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminSession,
} from "@/lib/admin/http";
import {
	PDF_IMPORT_MAX_CRITERIA,
	PDF_IMPORT_MAX_CRITERION_LENGTH,
	PDF_IMPORT_MAX_FILE_BYTES,
	PDF_IMPORT_MAX_GUIDANCE_LENGTH,
	type AdminPdfReadResponse,
} from "@/lib/admin/item-import-contract";
import { previewEntries } from "@/lib/admin/item-import-service";
import { readImportPdf } from "@/lib/admin/pdf-import";
import { readPdfProperties } from "@/lib/admin/pdf-properties";
import { assertPdfHeader } from "@/lib/admin/pdf-processing";

export const maxDuration = 300;

function criteriaFrom(value: FormDataEntryValue | null) {
	const parsed: unknown = JSON.parse(typeof value === "string" ? value : "[]");
	if (
		!Array.isArray(parsed) ||
		parsed.length > PDF_IMPORT_MAX_CRITERIA ||
		parsed.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > PDF_IMPORT_MAX_CRITERION_LENGTH)
	) {
		throw new AdminValidationError(
			`Use up to ${PDF_IMPORT_MAX_CRITERIA} checks of ${PDF_IMPORT_MAX_CRITERION_LENGTH} characters or fewer.`,
		);
	}
	return parsed as string[];
}

function guidanceFrom(value: FormDataEntryValue | null) {
	const guidance = typeof value === "string" ? value.trim() : "";
	if (guidance.length > PDF_IMPORT_MAX_GUIDANCE_LENGTH) throw new AdminValidationError(`Keep the AI instructions under ${PDF_IMPORT_MAX_GUIDANCE_LENGTH} characters in all.`);
	return guidance;
}

// A record can't be imported without these, so they are never left out.
const NEEDED_FIELDS = new Set(["creators", "itemType", "title"]);

/**
 * The reading as an import row. A field the AI got wrong, such as a web
 * address without https://, would hold back the whole record, so it is left
 * out and the record checked again; the editor can add it to the draft.
 */
async function previewReading(source: string, zoteroItem: Record<string, unknown>) {
	const db = await getDatabase();
	const [first] = (await previewEntries(db, [{ method: "pdf", source, zoteroItem }])).records;
	const wrong = Object.keys(first!.fields ?? {}).filter((field) => field in zoteroItem && !NEEDED_FIELDS.has(field));
	if (!wrong.length) return first!;
	const kept = Object.fromEntries(Object.entries(zoteroItem).filter(([field]) => !wrong.includes(field)));
	return (await previewEntries(db, [{ method: "pdf", source, zoteroItem: kept }])).records[0]!;
}

/** Reads one PDF into an import preview row and checks it against the library's criteria. */
export async function POST(request: NextRequest) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const form = await request.formData();
		const file = form.get("file");
		if (!(file instanceof File) || !file.size) throw new AdminValidationError("Choose a PDF file.");
		if (file.size > PDF_IMPORT_MAX_FILE_BYTES) throw new AdminValidationError(`${file.name} is larger than 50 MB.`);
		const criteria = criteriaFrom(form.get("criteria"));
		const guidance = guidanceFrom(form.get("guidance"));
		const bytes = new Uint8Array(await file.arrayBuffer());
		assertPdfHeader(bytes);

		const started = Date.now();
		const [reading, pdf] = await Promise.all([readImportPdf(bytes, file.name, criteria, guidance), readPdfProperties(bytes)]);
		const record = await previewReading(file.name, reading.zoteroItem);
		const response: AdminPdfReadResponse = {
			abstractWritten: reading.abstractWritten,
			checks: reading.checks,
			costUsd: reading.costUsd,
			inputTokens: reading.inputTokens,
			ms: Date.now() - started,
			outputTokens: reading.outputTokens,
			pdf,
			record,
			rightsFix: reading.rightsFix,
			topics: reading.topics,
		};
		return NextResponse.json(response, { headers: ADMIN_RESPONSE_HEADERS });
	} catch (error) {
		console.error("PDF import read failed", error);
		return adminErrorResponse(error);
	}
}
