import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminSession,
} from "@/lib/admin/http";
import { getAdminSourceIssues } from "@/lib/admin/library-query-service";

type Context = { params: Promise<{ key: string }> };

export async function GET(request: NextRequest, { params }: Context) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;
	const { key } = await params;
	return getAdminSourceIssues(await getDatabase(), key).then(
		(issues) =>
			NextResponse.json(issues, { headers: ADMIN_RESPONSE_HEADERS }),
		adminErrorResponse,
	);
}
