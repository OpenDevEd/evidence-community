import { NextResponse, type NextRequest } from "next/server";

import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse, requireAdminSession } from "@/lib/admin/http";
import { downloadSourcePdf, stageSourcePdf } from "@/lib/admin/source-file-choice";

type Context = { params: Promise<{ key: string }> };

/** A Zotero attachment's PDF, read from Zotero with the source's key, so an editor can open it before publishing it. */
export async function GET(request: NextRequest, { params }: Context) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;
	try {
		const [{ key }, runtime] = await Promise.all([params, getNativeFileRuntime()]);
		const { bytes, filename } = await downloadSourcePdf(runtime.db, runtime.config, key);
		return new NextResponse(new Uint8Array(bytes), {
			headers: {
				...ADMIN_RESPONSE_HEADERS,
				"Content-Type": "application/pdf",
				"Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
			},
		});
	} catch (error) {
		return adminErrorResponse(error);
	}
}

/** Stages the Zotero PDF in the working draft, to publish once a review approves it. */
export async function POST(request: NextRequest, { params }: Context) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;
	try {
		const [{ key }, runtime] = await Promise.all([params, getNativeFileRuntime()]);
		await stageSourcePdf(runtime.db, runtime.config, key);
		return new NextResponse(null, { status: 204, headers: ADMIN_RESPONSE_HEADERS });
	} catch (error) {
		return adminErrorResponse(error);
	}
}
