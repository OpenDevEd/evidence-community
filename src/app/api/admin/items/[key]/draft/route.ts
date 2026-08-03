import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminBypass,
} from "@/lib/admin/http";
import {
	discardNativeItemDraft,
	getNativeItemDraft,
	openNativeItemDraft,
	saveNativeItemDraft,
} from "@/lib/admin/native-item-service";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";

type RouteContext = {
	params: Promise<{ key: string }>;
};

const saveBodySchema = z.object({
	expectedDraftRevision: z.number().int().positive(),
	payload: z.record(z.string(), z.unknown()),
});

export async function GET(_request: NextRequest, { params }: RouteContext) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const { key } = await params;
		const draft = await getNativeItemDraft(await getDatabase(), key);
		return NextResponse.json(
			{ draft },
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const { key } = await params;
		const draft = await openNativeItemDraft(await getDatabase(), key);
		return NextResponse.json(
			{ draft },
			{ status: 201, headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const { key } = await params;
		const body = saveBodySchema.parse(await readAdminJson(request));
		const draft = await saveNativeItemDraft(await getDatabase(), {
			itemKey: key,
			...body,
		});
		return NextResponse.json(
			{ draft },
			{ headers: ADMIN_RESPONSE_HEADERS },
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
		const discarded = await discardNativeItemDraft(runtime.db, key);
		if (discarded.stagedPrivatePaths.length > 0) {
			try {
				await runtime.storage.removePrivate(
					discarded.stagedPrivatePaths,
				);
			} catch (error) {
				console.error(
					"Failed to remove discarded private file objects",
					error,
				);
			}
		}
		return new NextResponse(null, {
			status: 204,
			headers: ADMIN_RESPONSE_HEADERS,
		});
	} catch (error) {
		return adminErrorResponse(error);
	}
}
