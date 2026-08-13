import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminSession,
} from "@/lib/admin/http";
import { fileDraftJson } from "@/lib/admin/file-projection";
import { completeNativePdfUpload } from "@/lib/admin/native-file-service";

const bodySchema = z
	.object({
		expectedUploadRevision: z.number().int().positive(),
	})
	.strict();

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const [{ key }, body, runtime] = await Promise.all([
			params,
			readAdminJson(request).then((value) => bodySchema.parse(value)),
			getNativeFileRuntime(),
		]);
		const fileDraft = await completeNativePdfUpload(
			runtime.db,
			runtime.storage,
			{
				...body,
				itemKey: key,
				maxPdfBytes: runtime.config.services.storage.maxPdfBytes,
			},
		);
		return NextResponse.json(
			{ fileDraft: fileDraftJson(fileDraft) },
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
