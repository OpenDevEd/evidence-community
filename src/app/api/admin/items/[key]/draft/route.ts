import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminBypass,
} from "@/lib/admin/http";
import {
	discardNativeItemDraft,
	getNativeItemDraft,
	openNativeItemDraft,
	saveNativeItemDraft,
} from "@/lib/admin/native-item-service";

type RouteContext = {
	params: Promise<{ key: string }>;
};

const saveBodySchema = z.object({
	expectedDraftRevision: z.number().int().positive(),
	payload: z.record(z.string(), z.unknown()),
});

export async function GET(
	_request: NextRequest,
	{ params }: RouteContext,
) {
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

export async function POST(
	_request: NextRequest,
	{ params }: RouteContext,
) {
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

export async function PUT(
	request: NextRequest,
	{ params }: RouteContext,
) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const { key } = await params;
		const body = saveBodySchema.parse(await request.json());
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

export async function DELETE(
	_request: NextRequest,
	{ params }: RouteContext,
) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const { key } = await params;
		await discardNativeItemDraft(await getDatabase(), key);
		return new NextResponse(null, {
			status: 204,
			headers: ADMIN_RESPONSE_HEADERS,
		});
	} catch (error) {
		return adminErrorResponse(error);
	}
}
