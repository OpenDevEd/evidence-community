import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import { revalidateIndexedReceiptCaches } from "@/lib/admin/cache";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminSession,
} from "@/lib/admin/http";
import { adminSearchIndexReceiptsSchema } from "@/lib/admin/search-index-contract";
import { getAdminSearchIndexReceipts } from "@/lib/admin/search-index-service";

export async function POST(request: NextRequest) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const { receipts } = adminSearchIndexReceiptsSchema.parse(
			await readAdminJson(request),
		);
		const statuses = await getAdminSearchIndexReceipts(
			await getDatabase(),
			receipts,
		);
		revalidateIndexedReceiptCaches(statuses);
		return NextResponse.json(
			{ receipts: statuses },
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
