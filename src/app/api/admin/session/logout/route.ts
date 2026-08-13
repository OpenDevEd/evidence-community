import { NextRequest, NextResponse } from "next/server";

import {
	adminSessionCookieName,
	adminSessionCookieOptions,
} from "@/lib/admin/access";
import {
	getExternalRequestOrigin,
	hasMatchingRequestOrigin,
} from "@/lib/runtime-routing";

export async function POST(request: NextRequest) {
	const requestUrl = new URL(request.url);
	if (!hasMatchingRequestOrigin(requestUrl, request.headers)) {
		return new NextResponse("This request came from a different site.", {
			status: 403,
		});
	}

	const response = NextResponse.redirect(
		new URL(
			"/admin",
			getExternalRequestOrigin(requestUrl, request.headers) ??
				request.url,
		),
		303,
	);
	response.cookies.set(adminSessionCookieName(), "", {
		...adminSessionCookieOptions(),
		maxAge: 0,
	});
	return response;
}
