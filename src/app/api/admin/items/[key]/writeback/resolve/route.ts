import { NextRequest, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	readAdminJson,
	requireAdminSession,
} from "@/lib/admin/http";
import { resolveAdminSourceWritebackConflict } from "@/lib/admin/source-writeback-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import { adminWritebackResolveRequestSchema } from "@/lib/admin/writeback-request-contract";
import { createSourceWritebackRuntime } from "@/lib/source-writeback/runtime";

export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	const denied = await requireAdminSession(request);
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
		const { choice } = adminWritebackResolveRequestSchema.parse(
			await readAdminJson(request),
		);
		const [database, config] = await Promise.all([
			getDatabase(),
			getLibraryConfig(),
		]);
		const { indexingRecords, status } =
			await resolveAdminSourceWritebackConflict(
				database,
				key,
				sourceKey,
				choice,
				config,
				{ ...createSourceWritebackRuntime(config), signal: request.signal },
			);
		return NextResponse.json(
			{
				indexingReceipts: indexingRecords.map((record) =>
					adminSearchIndexReceipt("item", record),
				),
				status,
			},
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
