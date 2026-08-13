import { connection, NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminSession,
} from "@/lib/admin/http";
import { getAdminSearchIndexOverview } from "@/lib/admin/search-index-service";

export async function GET(request: NextRequest) {
	await connection();
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		return NextResponse.json(
			await getAdminSearchIndexOverview(await getDatabase()),
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
