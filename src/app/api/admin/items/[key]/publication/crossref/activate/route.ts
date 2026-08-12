import { NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminBypass,
} from "@/lib/admin/http";
import { activateCrossrefPublication } from "@/lib/publication/crossref-activation-service";

export async function POST(
	_request: Request,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const { key } = await params;
		const config = await getLibraryConfig();
		const database = await getDatabaseForConfig(config);
		return NextResponse.json(
			{
				activation: await activateCrossrefPublication(
					database,
					key,
					config,
				),
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
