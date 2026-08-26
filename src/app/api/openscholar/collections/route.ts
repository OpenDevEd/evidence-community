import { connection, NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import { listOpenScholarCollections } from "@/lib/admin/collection-catalog-service";
import { adminErrorResponse } from "@/lib/admin/http";
import {
	OPENSCHOLAR_RESPONSE_HEADERS,
	requireOpenScholarBearer,
} from "@/lib/admin/openscholar-bearer";

export async function GET(request: NextRequest) {
	await connection();

	const denied = await requireOpenScholarBearer(request);
	if (denied) return denied;

	try {
		const { searchParams } = request.nextUrl;
		return NextResponse.json(
			await listOpenScholarCollections(await getDatabase(), {
				cursor: searchParams.get("cursor"),
				pageSize: searchParams.get("pageSize") ?? undefined,
				query: searchParams.get("query") ?? undefined,
			}),
			{ headers: OPENSCHOLAR_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
