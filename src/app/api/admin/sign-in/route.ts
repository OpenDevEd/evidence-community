import { connection, NextRequest, NextResponse } from "next/server";

import { getReaderAuth, OPENSCHOLAR_PROVIDER_ID } from "@/lib/readers/auth";
import { getValidatedAdminReturnPath } from "@/lib/runtime-routing";

/**
 * Starts OpenScholar sign-in for an admin page. `/admin` without a session
 * redirects here, so a plain GET can begin the OAuth flow and come back to the
 * page that was asked for.
 */
export async function GET(request: NextRequest) {
	await connection();
	const { auth } = await getReaderAuth();
	const returnPath = getValidatedAdminReturnPath(request.nextUrl.searchParams.get("return"));
	const { headers, response } = await auth.api.signInSocial({
		body: { provider: OPENSCHOLAR_PROVIDER_ID, callbackURL: returnPath, disableRedirect: true },
		headers: request.headers,
		returnHeaders: true,
	});
	if (!response.url) throw new Error("OpenScholar sign-in returned no authorization address");
	const redirect = NextResponse.redirect(response.url, 307);
	for (const cookie of headers.getSetCookie()) redirect.headers.append("set-cookie", cookie);
	redirect.headers.set("Cache-Control", "no-store");
	return redirect;
}
