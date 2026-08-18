import { NextRequest, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readOptionalAdminJson,
	requireAdminSession,
} from "@/lib/admin/http";
import { publishItemDraftWithContext } from "@/lib/admin/native-item-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import { adminPublishRequestSchema } from "@/lib/admin/writeback-request-contract";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const { key } = await params;
		const { sourceKeys } = adminPublishRequestSchema.parse(
			await readOptionalAdminJson(request),
		);
		const [db, writebackConfig] = await Promise.all([
			getDatabase(),
			getLibraryConfig(),
		]);
		const { indexingRecords, item } = await publishItemDraftWithContext(
			db,
			key,
			{ sourceKeys, writebackConfig },
		);
		return NextResponse.json(
			{
				indexingReceipts: indexingRecords.map((record) =>
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
