import type { NextRequest } from "next/server";
import { z } from "zod";

import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { AdminValidationError } from "@/lib/admin/errors";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { handleAdminJson, readAdminJson } from "@/lib/admin/http";
import {
	PDF_IMPORT_MAX_CRITERIA,
	PDF_IMPORT_MAX_CRITERION_LENGTH,
	PDF_IMPORT_MAX_FILE_BYTES,
	PDF_IMPORT_MAX_FILES,
	PDF_IMPORT_MAX_GUIDANCE_LENGTH,
	adminImportRequestSchema,
} from "@/lib/admin/item-import-contract";
import { closePdfImport, commitPdfImport, pdfImportStatus, startPdfImport, storePdfImportFile } from "@/lib/admin/pdf-import-service";

// Importing gives each new draft its PDF, which takes a moment per file.
export const maxDuration = 300;

const startSchema = z.object({
	action: z.literal("start"),
	checks: z.array(z.string().trim().min(1).max(PDF_IMPORT_MAX_CRITERION_LENGTH)).max(PDF_IMPORT_MAX_CRITERIA),
	collections: z.array(z.string()).max(50),
	filenames: z.array(z.string().min(1).max(500)).min(1).max(PDF_IMPORT_MAX_FILES),
	instructions: z.string().trim().max(PDF_IMPORT_MAX_GUIDANCE_LENGTH, `Keep the AI instructions under ${PDF_IMPORT_MAX_GUIDANCE_LENGTH} characters in all.`),
});

const closeSchema = z.object({ action: z.literal("close"), importId: z.string().uuid() });

/** The library's PDF import, as the publication worker has read it so far. */
export function GET(request: NextRequest) {
	return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => pdfImportStatus((await getNativeFileRuntime()).db));
}

/**
 * Starts the import, takes its PDFs one per request, imports the chosen
 * records with their PDFs, or closes it.
 */
export function POST(request: NextRequest) {
	return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async (session) => {
		const runtime = await getNativeFileRuntime();
		if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
			const form = await request.formData();
			const [file, fileId] = [form.get("file"), form.get("fileId")];
			if (!(file instanceof File) || !file.size || typeof fileId !== "string") throw new AdminValidationError("Choose a PDF file.");
			if (file.size > PDF_IMPORT_MAX_FILE_BYTES) throw new AdminValidationError(`${file.name} is larger than 50 MB.`);
			await storePdfImportFile(runtime.db, runtime.storage, fileId, new Uint8Array(await file.arrayBuffer()));
			return { stored: fileId };
		}
		const body = (await readAdminJson(request)) as { action?: unknown };
		if (body.action === "start") return startPdfImport(runtime.db, { ...startSchema.parse(body), createdBy: session.clerkUserId });
		if (body.action === "close") {
			const { importId } = closeSchema.parse(body);
			await closePdfImport(runtime.db, runtime.storage, importId);
			return { closed: importId };
		}
		const commit = adminImportRequestSchema.parse({ ...body, action: "commit" });
		if (commit.action !== "commit") throw new AdminValidationError("Choose the records to import.");
		return commitPdfImport(runtime.db, runtime.storage, runtime.config.services.storage.maxPdfBytes, commit);
	});
}
