import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import { revalidatePublishedItemCaches } from "@/lib/admin/cache";
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
		revalidatePublishedItemCaches(item.key, item.parentItem);
		return NextResponse.json(
			{
				...(result.changed
					? {
							indexingReceipts: result.indexingRecords.map(
								(record) =>
									adminSearchIndexReceipt("item", record),
							),
						}
					: {}),
				item,
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
