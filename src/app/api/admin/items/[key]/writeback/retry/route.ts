import { NextRequest, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminPublisher,
} from "@/lib/admin/http";
import { retryAdminSourceWriteback } from "@/lib/admin/source-writeback-service";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = await requireAdminPublisher(request);
	if (denied) return denied;

	try {
		const { key } = await params;
		const sourceKey = request.nextUrl.searchParams.get("source");
		if (!sourceKey) {
			return NextResponse.json(
				{ error: "Missing source. Add ?source=<source key>." },
				{ headers: ADMIN_RESPONSE_HEADERS, status: 400 },
			);
		}
		const [database, config] = await Promise.all([
			getDatabase(),
			getLibraryConfig(),
		]);
		return NextResponse.json(
			{
				status: await retryAdminSourceWriteback(
					database,
					key,
					sourceKey,
					config,
				),
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
