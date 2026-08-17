import { NextRequest, NextResponse } from "next/server";

import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminSession,
} from "@/lib/admin/http";
import { buildAdminPublicationView } from "@/lib/publication/admin-publication-view-service";

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const { key } = await params;
		return NextResponse.json(
			{ publication: await buildAdminPublicationView(key) },
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
