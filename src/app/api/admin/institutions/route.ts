import { connection, NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/db";
import { ADMIN_RESPONSE_HEADERS, handleAdminResponse } from "@/lib/admin/http";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { listInstitutionCounts } from "@/lib/admin/openscholar-institutions";

export async function GET(request: NextRequest) {
	await connection();
	return handleAdminResponse(request, ADMIN_CONTENT_PERMISSION, async () =>
		NextResponse.json(
			await listInstitutionCounts(
				await getDatabase(),
				Object.fromEntries(request.nextUrl.searchParams),
			),
			{ headers: ADMIN_RESPONSE_HEADERS },
		),
	);
}
