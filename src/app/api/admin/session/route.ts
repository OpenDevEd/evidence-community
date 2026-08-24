import { NextRequest, NextResponse } from "next/server";

import {
	adminSessionCookieName,
	adminSessionCookieOptions,
	createAdminSessionToken,
	getAdminAccessConfig,
} from "@/lib/admin/access";
import { redeemAdminLoginCode } from "@/lib/admin/open-scholar";
import { getExternalRequestOrigin } from "@/lib/runtime-routing";

function adminRedirect(request: NextRequest, path = "/admin") {
	const url = new URL(
		path,
		getExternalRequestOrigin(new URL(request.url), request.headers) ??
			request.url,
	);
	return NextResponse.redirect(url, 303);
}

export async function GET(request: NextRequest) {
	const config = await getAdminAccessConfig();
	const codes = request.nextUrl.searchParams.getAll("code");
	if (codes.length !== 1) {
		return adminRedirect(request, "/admin/access-error");
	}
	const identity = await redeemAdminLoginCode(codes[0], config);
	if (!identity) return adminRedirect(request, "/admin/access-error");

	const response = adminRedirect(request);
	response.cookies.set(
		adminSessionCookieName(),
		createAdminSessionToken(identity, config),
		adminSessionCookieOptions(),
	);
	return response;
}
