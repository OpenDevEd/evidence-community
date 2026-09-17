import { connection, NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/db";
import { ADMIN_RESPONSE_HEADERS, handleAdminResponse } from "@/lib/admin/http";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { withInstitutionCountries } from "@/lib/admin/institution-countries";
import { listInstitutionCounts } from "@/lib/admin/openscholar-institutions";

export async function GET(request: NextRequest) {
	await connection();
	return handleAdminResponse(request, ADMIN_CONTENT_PERMISSION, async () => {
		const database = await getDatabase();
		return NextResponse.json(
			await withInstitutionCountries(
				database,
				await listInstitutionCounts(
					database,
					Object.fromEntries(request.nextUrl.searchParams),
				),
			),
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	});
}
