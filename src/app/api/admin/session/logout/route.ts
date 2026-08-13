import { NextRequest, NextResponse } from "next/server";

import { adminSessionCookieName } from "@/lib/admin/access";

export async function POST(request: NextRequest) {
	const origin = request.headers.get("origin");
	if (origin && origin !== new URL(request.url).origin) {
		return new NextResponse("This request came from a different site.", {
			status: 403,
		});
	}

	const response = NextResponse.redirect(new URL("/admin", request.url), 303);
	response.cookies.delete(adminSessionCookieName());
	return response;
}
