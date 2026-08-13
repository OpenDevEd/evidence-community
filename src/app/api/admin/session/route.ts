import { NextRequest, NextResponse } from "next/server";

import {
	adminSessionCookieName,
	adminPasswordMatches,
	adminSessionCookieOptions,
	consumeAdminLoginAttempt,
	createAdminSessionToken,
	getAdminCredentials,
	getAdminLoginStatus,
} from "@/lib/admin/access";

function adminRedirect(request: NextRequest, status?: string) {
	const url = new URL("/admin", request.url);
	if (status) url.searchParams.set("login", status);
	return NextResponse.redirect(url, 303);
}

function hasValidOrigin(request: NextRequest) {
	const origin = request.headers.get("origin");
	return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: NextRequest) {
	if (!hasValidOrigin(request)) {
		return new NextResponse("This request came from a different site.", {
			status: 403,
		});
	}

	const credentials = await getAdminCredentials();
	if (!credentials) return adminRedirect(request, "unavailable");
	if (!getAdminLoginStatus(request.headers).allowed) {
		return adminRedirect(request, "limited");
	}

	const password = (await request.formData()).get("password");
	if (
		typeof password !== "string" ||
		!adminPasswordMatches(password, credentials)
	) {
		consumeAdminLoginAttempt(request.headers);
		return adminRedirect(request, "invalid");
	}

	const response = adminRedirect(request);
	response.cookies.set(
		adminSessionCookieName(),
		createAdminSessionToken(credentials),
		adminSessionCookieOptions(),
	);
	return response;
}
