import { NextResponse, type NextRequest } from "next/server";

import {
	ADMIN_PUBLISH_PERMISSION,
	adminSessionCookieOptions,
	createLiveViewToken,
	getAdminAccessConfig,
	liveViewCookieName,
	verifyLiveViewToken,
} from "@/lib/admin/access";
import { ADMIN_RESPONSE_HEADERS, handleAdminResponse } from "@/lib/admin/http";

const noContent = () => new NextResponse(null, { status: 204, headers: ADMIN_RESPONSE_HEADERS });

// Live view: this browser reads records live instead of from the public cache,
// and those reads are never saved, so visitors keep the cached pages.
export function POST(request: NextRequest) {
	return handleAdminResponse(request, ADMIN_PUBLISH_PERMISSION, async (session) => {
		const response = noContent();
		const { secret } = await getAdminAccessConfig();
		response.cookies.set(liveViewCookieName(), createLiveViewToken(session.clerkUserId, secret), adminSessionCookieOptions());
		console.info("Live view turned on", { adminId: session.clerkUserId, role: session.role, at: new Date().toISOString() });
		return response;
	});
}

// Anyone may leave live view, so an expired session never traps a browser in it.
export async function DELETE(request: NextRequest) {
	const { secret } = await getAdminAccessConfig();
	const adminId = verifyLiveViewToken(request.cookies.get(liveViewCookieName())?.value, secret);
	const response = noContent();
	response.cookies.set(liveViewCookieName(), "", { ...adminSessionCookieOptions(), maxAge: 0 });
	console.info("Live view turned off", { adminId, at: new Date().toISOString() });
	return response;
}
