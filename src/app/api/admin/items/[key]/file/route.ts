import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminBypass,
} from "@/lib/admin/http";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import {
	getNativeFileState,
	stageNativePdfUpload,
	unpublishNativePdf,
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

export async function GET(
	_request: NextRequest,
	{ params }: RouteContext,
) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const [{ key }, { db }] = await Promise.all([
			params,
			getNativeFileRuntime(),
		]);
		const file = await getNativeFileState(db, key);
		return NextResponse.json(
			{ file },
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}

export async function POST(
	request: NextRequest,
	{ params }: RouteContext,
) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const [{ key }, body, runtime] = await Promise.all([
			params,
			request.json().then((value) => stageBodySchema.parse(value)),
			getNativeFileRuntime(),
		]);
		const staged = await stageNativePdfUpload(
			runtime.db,
			runtime.storage,
			{
				...body,
				itemKey: key,
				maxPdfBytes:
					runtime.config.services.storage.maxPdfBytes,
			},
		);
		return NextResponse.json(staged, {
			status: 201,
			headers: ADMIN_RESPONSE_HEADERS,
		});
	} catch (error) {
		return adminErrorResponse(error);
	}
}

export async function DELETE(
	_request: NextRequest,
	{ params }: RouteContext,
) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const [{ key }, runtime] = await Promise.all([
			params,
			getNativeFileRuntime(),
		]);
		const item = await unpublishNativePdf(
			runtime.db,
			runtime.storage,
			key,
		);
		return NextResponse.json(
			{ item },
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
