import { draftMode } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import {
	ADMIN_PUBLISH_PERMISSION,
	adminSessionCookieName,
	getAdminAccessConfig,
	verifyAdminSessionToken,
} from "@/lib/admin/access";
import { ADMIN_RESPONSE_HEADERS, handleAdminResponse } from "@/lib/admin/http";

const noContent = () => new NextResponse(null, { status: 204, headers: ADMIN_RESPONSE_HEADERS });

// Live view is Next's Draft Mode: this browser skips every "use cache" entry
// and saves nothing, so visitors keep the cached pages.
export function POST(request: NextRequest) {
	return handleAdminResponse(request, ADMIN_PUBLISH_PERMISSION, async (session) => {
		(await draftMode()).enable();
		console.info("Live view turned on", { adminId: session.clerkUserId, role: session.role, at: new Date().toISOString() });
		return noContent();
	});
}

// Anyone may leave live view, so an expired session never traps a browser in it.
export async function DELETE(request: NextRequest) {
	(await draftMode()).disable();
	const session = verifyAdminSessionToken(request.cookies.get(adminSessionCookieName())?.value, await getAdminAccessConfig());
	console.info("Live view turned off", { adminId: session?.clerkUserId ?? null, at: new Date().toISOString() });
	return noContent();
}
