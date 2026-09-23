import { connection, NextRequest, NextResponse } from "next/server";

import { getDatabaseForConfig } from "@/db";
import { getLibraryConfig } from "@/config/library-config/server";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse } from "@/lib/admin/http";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";
import { listReviewedPublications } from "@/lib/admin/reviewed-publication-catalog";

export async function GET(request: NextRequest) {
	await connection();

	const config = await getLibraryConfig();
	const denied = await requireOpenScholarBearer(request, config.authentication.openScholar.machineCredential);
	if (denied) return denied;

	try {
		const { searchParams } = request.nextUrl;
		return NextResponse.json(
			await listReviewedPublications(
				await getDatabaseForConfig(config),
				{
					cursor: searchParams.get("cursor"),
					ids: searchParams.get("ids"),
					pageSize: searchParams.get("pageSize") ?? undefined,
					query: searchParams.get("query") ?? undefined,
				},
				config.content.tags.hidden,
			),
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
