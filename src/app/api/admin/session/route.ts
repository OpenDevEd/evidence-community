import { connection, NextRequest, NextResponse } from "next/server";

import {
	type AdminAccessConfig,
	adminSessionCookieName,
	adminSessionCookieOptions,
	createAdminSessionToken,
	getAdminAccessConfig,
} from "@/lib/admin/access";
import { redeemAdminLoginCode } from "@/lib/admin/open-scholar";
import {
	buildAdminLoginPageUrl,
	getExternalRequestOrigin,
	getValidatedAdminReturnPath,
} from "@/lib/runtime-routing";

function adminRedirect(request: NextRequest, path: string) {
	const url = new URL(
		path,
		getExternalRequestOrigin(new URL(request.url), request.headers) ??
			request.url,
	);
	return NextResponse.redirect(url, 303);
}

function loginPageRedirect(config: AdminAccessConfig, returnPath: string) {
	return NextResponse.redirect(
		buildAdminLoginPageUrl(config.loginPageUrl, returnPath, "invalid_code"),
		303,
	);
}

export async function GET(request: NextRequest) {
	await connection();

	const config = await getAdminAccessConfig();
	const returnPath = getValidatedAdminReturnPath(
		request.nextUrl.searchParams.get("return"),
	);
	const codes = request.nextUrl.searchParams.getAll("code");
	if (codes.length !== 1) return loginPageRedirect(config, returnPath);

	const identity = await redeemAdminLoginCode(codes[0], config);
	if (!identity) return loginPageRedirect(config, returnPath);

	const response = adminRedirect(request, returnPath);
	response.cookies.set(
		adminSessionCookieName(),
		createAdminSessionToken(identity, config),
		adminSessionCookieOptions(),
	);
	return response;
}
