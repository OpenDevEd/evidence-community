import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { itemPublishingChoice } from "@/db/schema/review";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse, readAdminJson, readAdminPermission } from "@/lib/admin/http";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { setItemPublishingChoice } from "@/lib/admin/review-service";

type Context = { params: Promise<{ key: string }> };
export async function GET(request: NextRequest, { params }: Context) {
	const access = await readAdminPermission(request, ADMIN_CONTENT_PERMISSION);
	if (access.denied) return access.denied;
	try {
		const [{ key }, runtime] = await Promise.all([params, getNativeFileRuntime()]);
		const [stored] = await runtime.db.select().from(itemPublishingChoice).where(eq(itemPublishingChoice.itemKey, key));
		return NextResponse.json({ choice: stored?.choice ?? null }, { headers: ADMIN_RESPONSE_HEADERS });
	} catch (error) { return adminErrorResponse(error); }
}
export async function PUT(request: NextRequest, { params }: Context) {
	const access = await readAdminPermission(request, ADMIN_CONTENT_PERMISSION);
	if (access.denied) return access.denied;
	try {
		const [{ key }, runtime, body] = await Promise.all([params, getNativeFileRuntime(), readAdminJson(request)]);
		return NextResponse.json({ choice: await setItemPublishingChoice(runtime.db, key, body) }, { headers: ADMIN_RESPONSE_HEADERS });
	} catch (error) { return adminErrorResponse(error); }
}
