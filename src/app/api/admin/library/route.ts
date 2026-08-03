import { connection, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminBypass,
} from "@/lib/admin/http";
import { getAdminLibrarySnapshot } from "@/lib/admin/library-query-service";

export async function GET() {
	await connection();

	const denied = requireAdminBypass();
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
