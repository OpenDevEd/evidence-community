import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminBypass,
} from "@/lib/admin/http";
import { adminSearchIndexReceiptsSchema } from "@/lib/admin/search-index-contract";
import { getAdminSearchIndexReceipts } from "@/lib/admin/search-index-service";

export async function POST(request: NextRequest) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const { receipts } = adminSearchIndexReceiptsSchema.parse(
			await readAdminJson(request),
		);
		return NextResponse.json(
			{
				receipts: await getAdminSearchIndexReceipts(
					await getDatabase(),
					receipts,
				),
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
