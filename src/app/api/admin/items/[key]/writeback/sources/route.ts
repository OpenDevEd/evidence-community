import { NextRequest, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminSession,
} from "@/lib/admin/http";
import { setAdminItemWritebackSources } from "@/lib/admin/source-writeback-service";
import { adminWritebackSourcesRequestSchema } from "@/lib/admin/writeback-request-contract";

export async function PUT(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;

	try {
		const { key } = await params;
		const { sourceKeys } = adminWritebackSourcesRequestSchema.parse(
			await readAdminJson(request),
		);
		const [database, config] = await Promise.all([
			getDatabase(),
			getLibraryConfig(),
		]);
		return NextResponse.json(
			{
				writeback: await setAdminItemWritebackSources(
					database,
					key,
					sourceKeys,
					config,
				),
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
