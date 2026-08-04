import { connection, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminBypass,
} from "@/lib/admin/http";
import { getAdminSearchIndexOverview } from "@/lib/admin/search-index-service";

export async function GET() {
	await connection();
	const denied = requireAdminBypass();
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
