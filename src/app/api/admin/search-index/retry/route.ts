import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminPublisher,
} from "@/lib/admin/http";
import { adminSearchIndexRetrySchema } from "@/lib/admin/search-index-contract";
import { retryAdminSearchIndexFailures } from "@/lib/admin/search-index-service";

export async function POST(request: NextRequest) {
	const denied = await requireAdminPublisher(request);
	if (denied) return denied;

	try {
		const input = adminSearchIndexRetrySchema.parse(
			await readAdminJson(request),
		);
		return NextResponse.json(
			await retryAdminSearchIndexFailures(await getDatabase(), input),
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
