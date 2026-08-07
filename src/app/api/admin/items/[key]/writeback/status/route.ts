import { NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminBypass,
} from "@/lib/admin/http";
import { getAdminSourceWritebackStatus } from "@/lib/admin/source-writeback-service";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const { key } = await params;
		const [database, config] = await Promise.all([
			getDatabase(),
			getLibraryConfig(),
		]);
		return NextResponse.json(
			{ status: await getAdminSourceWritebackStatus(database, key, config) },
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
