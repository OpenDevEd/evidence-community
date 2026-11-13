import { connection, NextRequest, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getReaderAuthForConfig } from "@/lib/readers/instance";
import { OPENSCHOLAR_PROVIDER_ID } from "@/lib/readers/openscholar";
import { ASK_AGAIN_COOKIE } from "@/lib/readers/session-follow";
import { getValidatedAdminReturnPath } from "@/lib/runtime-routing";

/**
 * Starts OpenScholar sign-in for an admin page. `/admin` without a session
 * redirects here, so a plain GET can begin the OAuth flow and come back to the
 * page that was asked for. It goes through Better Auth's own sign-in endpoint,
 * so the same rate limit applies as to the Sign in button.
 */
export async function GET(request: NextRequest) {
	await connection();
	const config = await getLibraryConfig();
	const { auth } = await getReaderAuthForConfig(config);
	const returnPath = getValidatedAdminReturnPath(request.nextUrl.searchParams.get("return"));
	const forwardedFor = request.headers.get("x-forwarded-for");
	const cookie = request.headers.get("cookie");
	const response = await auth.handler(
		new Request(new URL("/api/auth/sign-in/social", config.identity.baseUrl), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: new URL(config.identity.baseUrl).origin,
				...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
				...(cookie ? { Cookie: cookie } : {}),
			},
			body: JSON.stringify({ provider: OPENSCHOLAR_PROVIDER_ID, callbackURL: returnPath, disableRedirect: true }),
		}),
	);
	if (!response.ok) {
		return new NextResponse(null, { status: response.status, headers: { "Cache-Control": "no-store" } });
	}
	const { url } = (await response.json()) as { url?: string };
	if (!url) throw new Error("Openscholar sign-in returned no authorization address");
	const signIn = new URL(url);
	// Signed out here since: Clerk asks who is signing in instead of taking the account it still holds, as the Sign in button does.
	if (request.cookies.has(ASK_AGAIN_COOKIE)) signIn.searchParams.set("prompt", "login");
	const redirect = NextResponse.redirect(signIn, 307);
	for (const setCookie of response.headers.getSetCookie()) redirect.headers.append("set-cookie", setCookie);
	redirect.headers.set("Cache-Control", "no-store");
	return redirect;
}
