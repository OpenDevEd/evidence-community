import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminSession,
} from "@/lib/admin/http";
import { retryCrossrefPublication } from "@/lib/publication/crossref-activation-service";
import { buildAdminPublicationView } from "@/lib/publication/admin-publication-view-service";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const { key } = await params;
		const database = await getDatabase();
		const activation = await retryCrossrefPublication(database, key);
		return NextResponse.json(
			{
				activation,
				publication: await buildAdminPublicationView(key),
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
