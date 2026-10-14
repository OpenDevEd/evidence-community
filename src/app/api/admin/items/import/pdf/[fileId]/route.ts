import { type NextRequest, NextResponse } from "next/server";

import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { adminErrorResponse, requireAdminSession } from "@/lib/admin/http";
import { readPdfImportFile } from "@/lib/admin/pdf-import-service";

/** One PDF of the import, for its cover and for opening it during the review. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;
	try {
		const [{ fileId }, runtime] = await Promise.all([params, getNativeFileRuntime()]);
		const { bytes, filename } = await readPdfImportFile(runtime.db, runtime.storage, fileId);
		return new NextResponse(Buffer.from(bytes), {
			headers: { "Cache-Control": "private, max-age=3600", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`, "Content-Type": "application/pdf" },
		});
	} catch (error) {
		return adminErrorResponse(error);
	}
}
