import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminSession,
} from "@/lib/admin/http";
import {
	discardItemDraft,
	getItemDraft,
	openItemDraft,
	saveItemDraft,
} from "@/lib/admin/native-item-service";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { adminCanonicalDraftToItemFields } from "@/lib/admin/item-fields";

type RouteContext = {
	params: Promise<{ key: string }>;
};

const saveBodySchema = z.object({
	expectedDraftGeneration: z.uuid(),
	expectedDraftRevision: z.number().int().positive(),
	expectedPayload: z.record(z.string(), z.unknown()),
	payload: z.record(z.string(), z.unknown()),
});

export async function GET(request: NextRequest, { params }: RouteContext) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const { key } = await params;
		const draft = await getItemDraft(await getDatabase(), key);
		return NextResponse.json(
			{ draft: draft ? adminCanonicalDraftToItemFields(draft) : null },
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
		const { key } = await params;
		const [db, writebackConfig] = await Promise.all([
			getDatabase(),
			getLibraryConfig(),
		]);
		const draft = await openItemDraft(db, key, { writebackConfig });
		return NextResponse.json(
			{ draft: adminCanonicalDraftToItemFields(draft) },
			{ status: 201, headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const { key } = await params;
		const body = saveBodySchema.parse(await readAdminJson(request));
		const [db, writebackConfig] = await Promise.all([
			getDatabase(),
			getLibraryConfig(),
		]);
		const draft = await saveItemDraft(
			db,
			{
				itemKey: key,
				...body,
			},
			{ writebackConfig },
		);
		return NextResponse.json(
			{ draft: adminCanonicalDraftToItemFields(draft) },
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const [{ key }, runtime] = await Promise.all([
			params,
			getNativeFileRuntime(),
		]);
		const discarded = await discardItemDraft(runtime.db, key);
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
