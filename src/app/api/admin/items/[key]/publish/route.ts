import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import { revalidatePublishedItemCaches } from "@/lib/admin/cache";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminBypass,
} from "@/lib/admin/http";
import { publishNativeItemDraftWithContext } from "@/lib/admin/native-item-service";

export async function POST(
	_request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const { key } = await params;
		const { item, previousParentItem } =
			await publishNativeItemDraftWithContext(await getDatabase(), key);
		revalidatePublishedItemCaches(
			item.key,
			item.parentItem,
			previousParentItem,
		);
		return NextResponse.json({ item }, { headers: ADMIN_RESPONSE_HEADERS });
	} catch (error) {
		return adminErrorResponse(error);
	}
}
