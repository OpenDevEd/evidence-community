import { connection, NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import { listOpenScholarCollections } from "@/lib/admin/collection-catalog-service";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse } from "@/lib/admin/http";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";

export async function GET(request: NextRequest) {
	await connection();

	const denied = await requireOpenScholarBearer(request);
	if (denied) return denied;

	try {
		const { searchParams } = request.nextUrl;
		return NextResponse.json(
			await listOpenScholarCollections(await getDatabase(), {
				cursor: searchParams.get("cursor"),
				ids: searchParams.get("ids"),
				pageSize: searchParams.get("pageSize") ?? undefined,
				query: searchParams.get("query") ?? undefined,
			}),
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
