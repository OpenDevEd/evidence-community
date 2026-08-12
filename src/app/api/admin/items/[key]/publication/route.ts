import { NextResponse } from "next/server";

import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminBypass,
} from "@/lib/admin/http";
import { buildAdminPublicationView } from "@/lib/publication/admin-publication-view";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = requireAdminBypass();
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
