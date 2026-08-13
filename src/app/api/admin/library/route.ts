import { connection, NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminSession,
} from "@/lib/admin/http";
import { getAdminLibrarySnapshot } from "@/lib/admin/library-query-service";

export async function GET(request: NextRequest) {
	await connection();

	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		return NextResponse.json(
			await getAdminLibrarySnapshot(await getDatabase()),
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
