import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readOptionalAdminJson,
	requireAdminPublisher,
} from "@/lib/admin/http";
import { unpublishNativeItemWithOutcome } from "@/lib/admin/native-item-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import { adminUnpublishRequestSchema } from "@/lib/admin/writeback-request-contract";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = await requireAdminPublisher(request);
	if (denied) return denied;

	try {
		const { key } = await params;
		const { removeFromSourceKeys } = adminUnpublishRequestSchema.parse(
			await readOptionalAdminJson(request),
		);
		const result = await unpublishNativeItemWithOutcome(
			await getDatabase(),
			key,
			{ removeFromSourceKeys },
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
