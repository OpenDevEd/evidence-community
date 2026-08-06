import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminBypass,
} from "@/lib/admin/http";
import { revalidatePublishedItemCaches } from "@/lib/admin/cache";
import {
	fileDraftJson,
	filePublicationJson,
} from "@/lib/admin/file-projection";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import {
	getNativeFileState,
	stageNativePdfUpload,
	unpublishNativePdfWithContext,
} from "@/lib/admin/native-file-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";

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

export async function GET(_request: NextRequest, { params }: RouteContext) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const [{ key }, { db }] = await Promise.all([
			params,
			getNativeFileRuntime(),
		]);
		const file = await getNativeFileState(db, key);
		return NextResponse.json(
			{
				file: {
					draft: fileDraftJson(file.draft),
					publication: filePublicationJson(file.publication),
				},
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}

export async function POST(request: NextRequest, { params }: RouteContext) {
	const denied = requireAdminBypass();
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

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const [{ key }, runtime] = await Promise.all([
			params,
			getNativeFileRuntime(),
		]);
		const unpublished = await unpublishNativePdfWithContext(
			runtime.db,
			runtime.storage,
			key,
		);
		const { item } = unpublished;
		revalidatePublishedItemCaches(item.key, item.parentItem);
		return NextResponse.json(
			{
				indexingReceipts: unpublished.indexingRecords.map((record) =>
					adminSearchIndexReceipt("item", record),
				),
				item,
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
