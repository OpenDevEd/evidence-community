import { NextRequest, NextResponse } from "next/server";

import {
	adminSessionCookieName,
	adminPasswordMatches,
	adminSessionCookieOptions,
	consumeAdminLoginAttempt,
	createAdminSessionToken,
	getAdminCredentials,
	resetAdminLoginAttempts,
} from "@/lib/admin/access";
import {
	getExternalRequestOrigin,
	hasMatchingRequestOrigin,
} from "@/lib/runtime-routing";

function adminRedirect(request: NextRequest, status?: string) {
	const url = new URL(
		"/admin",
		getExternalRequestOrigin(new URL(request.url), request.headers) ??
			request.url,
	);
	if (status) url.searchParams.set("login", status);
	return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
	if (!hasMatchingRequestOrigin(new URL(request.url), request.headers)) {
		return new NextResponse("This request came from a different site.", {
			status: 403,
		});
	}

	const credentials = await getAdminCredentials();
	if (!credentials) return adminRedirect(request, "unavailable");
	if (!consumeAdminLoginAttempt(request.headers).allowed) {
		return adminRedirect(request, "limited");
	}

	const password = await request
		.formData()
		.then((formData) => formData.get("password"))
		.catch(() => null);
	if (
		typeof password !== "string" ||
		!adminPasswordMatches(password, credentials)
	) {
		return adminRedirect(request, "invalid");
	}
	resetAdminLoginAttempts(request.headers);

	const response = adminRedirect(request);
	response.cookies.set(
		adminSessionCookieName(),
		createAdminSessionToken(credentials),
		adminSessionCookieOptions(),
	);
	return response;
}
