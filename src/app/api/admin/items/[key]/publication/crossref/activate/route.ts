import { NextRequest, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminSession,
} from "@/lib/admin/http";
import { activateCrossrefPublication } from "@/lib/publication/crossref-activation-service";
import { buildAdminPublicationView } from "@/lib/publication/admin-publication-view-service";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const { key } = await params;
		const config = await getLibraryConfig();
		const database = await getDatabaseForConfig(config);
		const activation = await activateCrossrefPublication(
			database,
			key,
			config,
		);
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
