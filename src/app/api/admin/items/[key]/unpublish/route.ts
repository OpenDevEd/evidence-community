import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminBypass,
} from "@/lib/admin/http";
import { unpublishNativeItemWithOutcome } from "@/lib/admin/native-item-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";

export async function POST(
	_request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const { key } = await params;
		const result = await unpublishNativeItemWithOutcome(
			await getDatabase(),
			key,
		);
		const { item } = result;
		return NextResponse.json(
			{
				indexingReceipts: result.changed
					? result.indexingRecords.map((record) =>
							adminSearchIndexReceipt("item", record),
						)
					: [],
				item,
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
