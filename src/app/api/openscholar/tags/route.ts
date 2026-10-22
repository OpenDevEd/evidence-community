import { connection, NextRequest, NextResponse } from "next/server";

import { ADMIN_RESPONSE_HEADERS, adminErrorResponse } from "@/lib/admin/http";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";
import { listPublicTagCounts } from "@/lib/admin/openscholar-tag-reads";

/** The tags on the library's public records and their counts, a page at a time, for OpenScholar's tag filter settings. */
export async function GET(request: NextRequest) {
	await connection();

	const denied = await requireOpenScholarBearer(request);
	if (denied) return denied;

	try {
		return NextResponse.json(await listPublicTagCounts(Object.fromEntries(request.nextUrl.searchParams)), { headers: ADMIN_RESPONSE_HEADERS });
	} catch (error) {
		return adminErrorResponse(error);
	}
}
