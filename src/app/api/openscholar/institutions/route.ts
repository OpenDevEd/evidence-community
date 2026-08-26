import { connection, NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse } from "@/lib/admin/http";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";
import { listInstitutionCounts } from "@/lib/admin/openscholar-institutions";

export async function GET(request: NextRequest) {
	await connection();

	const denied = await requireOpenScholarBearer(request);
	if (denied) return denied;

	try {
		return NextResponse.json(
			{ items: await listInstitutionCounts(await getDatabase()) },
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
