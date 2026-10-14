import type { NextRequest } from "next/server";
import { z } from "zod";

import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { AdminValidationError } from "@/lib/admin/errors";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { handleAdminJson, readAdminJson } from "@/lib/admin/http";
import {
	PDF_IMPORT_MAX_CRITERIA,
	PDF_IMPORT_MAX_CRITERION_LENGTH,
	PDF_IMPORT_MAX_FILES,
	PDF_IMPORT_MAX_GUIDANCE_LENGTH,
	adminImportRequestSchema,
} from "@/lib/admin/item-import-contract";
import { closePdfImport, commitPdfImport, confirmPdfImportUpload, failPdfImportUpload, pdfImportStatus, startPdfImport } from "@/lib/admin/pdf-import-service";

const startSchema = z.object({
	action: z.literal("start"),
	checks: z.array(z.string().trim().min(1).max(PDF_IMPORT_MAX_CRITERION_LENGTH)).max(PDF_IMPORT_MAX_CRITERIA),
	collections: z.array(z.string()).max(50),
	files: z.array(z.object({ name: z.string().min(1).max(500), size: z.number().int().nonnegative() })).min(1).max(PDF_IMPORT_MAX_FILES),
	instructions: z.string().trim().max(PDF_IMPORT_MAX_GUIDANCE_LENGTH, `Keep the AI instructions under ${PDF_IMPORT_MAX_GUIDANCE_LENGTH} characters in all.`),
});

const closeSchema = z.object({ action: z.literal("close"), importId: z.string().uuid() });

const uploadedSchema = z.object({ action: z.literal("uploaded"), fileId: z.string().uuid() });

const uploadFailedSchema = z.object({ action: z.literal("upload-failed"), fileId: z.string().uuid(), message: z.string().max(500) });

/** The library's PDF import, as the publication worker has read it so far. */
export function GET(request: NextRequest) {
	return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => pdfImportStatus((await getNativeFileRuntime()).db));
}

type Runtime = Awaited<ReturnType<typeof getNativeFileRuntime>>;

// What each action of the import does, by name; any other body is the commit.
const actions: Record<string, (runtime: Runtime, body: unknown, clerkUserId: string) => Promise<Record<string, unknown>>> = {
	start: (runtime, body, clerkUserId) => startPdfImport(runtime.db, runtime.storage, runtime.config.services.storage.maxPdfBytes, { ...startSchema.parse(body), createdBy: clerkUserId }),
	uploaded: async (runtime, body) => {
		const { fileId } = uploadedSchema.parse(body);
		await confirmPdfImportUpload(runtime.db, runtime.storage, fileId);
		return { stored: fileId };
	},
	"upload-failed": async (runtime, body) => {
		const { fileId, message } = uploadFailedSchema.parse(body);
		await failPdfImportUpload(runtime.db, fileId, message);
		return { failed: fileId };
	},
	close: async (runtime, body) => {
		const { importId } = closeSchema.parse(body);
		await closePdfImport(runtime.db, runtime.storage, importId);
		return { closed: importId };
	},
};

async function commit(runtime: Runtime, body: unknown) {
	const request = adminImportRequestSchema.parse({ ...(body as object), action: "commit" });
	if (request.action !== "commit") throw new AdminValidationError("Choose the records to import.");
	return commitPdfImport(runtime.db, request);
}

/**
 * Starts the import with a signed upload for each PDF, hears that one
 * arrived or couldn't be sent, imports the chosen records with their PDFs,
 * or closes it.
 */
export function POST(request: NextRequest) {
	return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async (session) => {
		const runtime = await getNativeFileRuntime();
		const body = (await readAdminJson(request)) as { action?: unknown };
		const act = (typeof body.action === "string" && Object.hasOwn(actions, body.action) ? actions[body.action] : undefined) ?? commit;
		return act(runtime, body, session.clerkUserId);
	});
}
