import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminSession,
} from "@/lib/admin/http";
import { createNativeItemDraft } from "@/lib/admin/native-item-service";
import { adminCanonicalDraftToItemFields } from "@/lib/admin/item-fields";

export async function POST(request: NextRequest) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const draft = await createNativeItemDraft(
			await getDatabase(),
			await readAdminJson(request),
		);
		return NextResponse.json(
			{ draft: adminCanonicalDraftToItemFields(draft) },
			{ status: 201, headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
