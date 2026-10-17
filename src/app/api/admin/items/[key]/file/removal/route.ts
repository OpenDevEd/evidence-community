import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse, requireAdminSession } from "@/lib/admin/http";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { changePdfRemoval } from "@/lib/admin/source-file-choice";

type Context = { params: Promise<{ key: string }> };
async function change(request: NextRequest, { params }: Context, remove: boolean) {
	const denied = await requireAdminSession(request);
	if (denied) return denied;
	try {
		const [{ key }, runtime] = await Promise.all([params, getNativeFileRuntime()]);
		await changePdfRemoval(runtime, key, remove);
		return new NextResponse(null, { status: 204, headers: ADMIN_RESPONSE_HEADERS });
	} catch (error) { return adminErrorResponse(error); }
}
export async function POST(request: NextRequest, context: Context) { return change(request, context, true); }
export async function DELETE(request: NextRequest, context: Context) { return change(request, context, false); }
