import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminBypass,
} from "@/lib/admin/http";
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
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const [{ key }, body, runtime] = await Promise.all([
			params,
			request.json().then((value) => bodySchema.parse(value)),
			getNativeFileRuntime(),
		]);
		const fileDraft = await completeNativePdfUpload(
			runtime.db,
			runtime.storage,
			{
				...body,
				itemKey: key,
				maxPdfBytes:
					runtime.config.services.storage.maxPdfBytes,
			},
		);
		return NextResponse.json(
			{ fileDraft },
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
