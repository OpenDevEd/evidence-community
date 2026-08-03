import { NextRequest, NextResponse } from "next/server";

import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminBypass,
} from "@/lib/admin/http";
import { discardNativePdfDraft } from "@/lib/admin/native-file-service";

export async function DELETE(
	_request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const [{ key }, runtime] = await Promise.all([
			params,
			getNativeFileRuntime(),
		]);
		await discardNativePdfDraft(runtime.db, runtime.storage, key);
		return new NextResponse(null, {
			status: 204,
			headers: ADMIN_RESPONSE_HEADERS,
		});
	} catch (error) {
		return adminErrorResponse(error);
	}
}
