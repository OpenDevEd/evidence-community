import { NextRequest, NextResponse } from "next/server";
import { attachmentFilesHidden } from "@/lib/admin/withdrawn-files";
import { z } from "zod";

import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminSession,
} from "@/lib/admin/http";
import {
	fileDraftJson,
	filePublicationJson,
} from "@/lib/admin/file-projection";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import {
	getNativeFileState,
	stageNativePdfUpload,
} from "@/lib/admin/native-file-service";

type RouteContext = {
	params: Promise<{ key: string }>;
};

const stageBodySchema = z
	.object({
		expectedSha256: z.string(),
		expectedSizeBytes: z.number().int().positive(),
		filename: z.string(),
	})
	.strict();


export async function GET(request: NextRequest, { params }: RouteContext) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const [{ key }, { db }] = await Promise.all([
			params,
			getNativeFileRuntime(),
		]);
		const [file, hidden] = await Promise.all([getNativeFileState(db, key), attachmentFilesHidden(db, key)]);
		return NextResponse.json(
			{
				file: {
					draft: fileDraftJson(file.draft),
					publication: filePublicationJson(file.publication, hidden),
				},
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}

export async function POST(request: NextRequest, { params }: RouteContext) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const [{ key }, body, runtime] = await Promise.all([
			params,
			readAdminJson(request).then((value) =>
				stageBodySchema.parse(value),
			),
			getNativeFileRuntime(),
		]);
		const staged = await stageNativePdfUpload(runtime.db, runtime.storage, {
			...body,
			itemKey: key,
			maxPdfBytes: runtime.config.services.storage.maxPdfBytes,
		});
		return NextResponse.json(
			{
				fileDraft: fileDraftJson(staged.fileDraft),
				upload: staged.upload,
			},
			{
				status: 201,
				headers: ADMIN_RESPONSE_HEADERS,
			},
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
