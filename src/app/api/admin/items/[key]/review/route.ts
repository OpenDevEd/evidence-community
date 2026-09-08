import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse, readAdminPermission } from "@/lib/admin/http";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { getItemReviews, submitItemReview } from "@/lib/admin/review-service";

type Context = { params: Promise<{ key: string }> };
export async function GET(request: NextRequest, { params }: Context) {
	const access = await readAdminPermission(request, ADMIN_CONTENT_PERMISSION);
	if (access.denied) return access.denied;
	try {
		const [{ key }, runtime] = await Promise.all([params, getNativeFileRuntime()]);
		return NextResponse.json({ reviews: await getItemReviews(runtime.db, key) }, { headers: ADMIN_RESPONSE_HEADERS });
	} catch (error) { return adminErrorResponse(error); }
}
export async function POST(request: NextRequest, { params }: Context) {
	const access = await readAdminPermission(request, ADMIN_CONTENT_PERMISSION);
	if (access.denied) return access.denied;
	try {
		const [{ key }, runtime] = await Promise.all([params, getNativeFileRuntime()]);
		const review = await submitItemReview(runtime.db, key, { userId: access.session.clerkUserId, role: access.session.role });
		return NextResponse.json({ review }, { headers: ADMIN_RESPONSE_HEADERS });
	} catch (error) { return adminErrorResponse(error); }
}
