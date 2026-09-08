import { NextResponse, type NextRequest } from "next/server";
import { count, eq } from "drizzle-orm";
import { getDatabase } from "@/db";
import { itemReview } from "@/db/schema/review";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse, requireAdminSession } from "@/lib/admin/http";
export async function GET(request: NextRequest) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;
	try {
		const [result] = await (await getDatabase()).select({ count: count() }).from(itemReview).where(eq(itemReview.state, "pending"));
		return NextResponse.json({ count: result?.count ?? 0 }, { headers: ADMIN_RESPONSE_HEADERS });
	} catch (error) { return adminErrorResponse(error); }
}
