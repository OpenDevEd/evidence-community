// MOCK ONLY (mock/suggest-join-buttons). Stands in for two things the local stack has no Openscholar for: signing a
// reader in, and where they stand with joining the team. Not part of the build; delete when the mock is ported.
import { connection, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getReaderAuthForConfig } from "@/lib/readers/instance";

import { mintReaderSessionCookiesIn } from "../../../../tools/readerTestSession";

/** The sample people: a visitor outside the team, and one the stand-in Openscholar knows as a Creator. */
const PEOPLE = { visitor: { id: "user_mock_visitor", name: "Amira Haddad" }, creator: { id: "user_acceptance_creator", name: "Amira Haddad" } } as const;
const DAY = 60 * 60 * 24;

/**
 * `?signin=visitor|creator|out` signs a sample reader in or out, `?join=open|waiting|closed` sets where they stand
 * with joining, and `?next=/path` is where it goes after, as Openscholar's sign-in comes back to the page that asked.
 */
export async function GET(request: Request) {
	// Answered per request: a build would otherwise keep one answer for everyone.
	await connection();
	if (process.env.NODE_ENV === "production" && !process.env.LIBRARY_CONFIG_PATH?.includes(".verify")) return new NextResponse(null, { status: 404 });
	const url = new URL(request.url);
	const next = url.searchParams.get("next");
	const response = next?.startsWith("/") && !next.startsWith("//") ? NextResponse.redirect(new URL(next, `http://${request.headers.get("host")}`)) : NextResponse.json({ ok: true });
	const join = url.searchParams.get("join");
	if (join) response.cookies.set("mock_join", join, { path: "/", maxAge: DAY });
	const signin = url.searchParams.get("signin");
	if (signin === "out") {
		for (const part of (request.headers.get("cookie") ?? "").split(";")) {
			const name = part.split("=")[0]?.trim();
			if (name?.includes("evidence-library")) response.cookies.set(name, "", { path: "/", maxAge: 0, secure: true });
		}
		response.cookies.set("mock_join", "", { path: "/", maxAge: 0 });
	} else if (signin === "visitor" || signin === "creator") {
		const config = await getLibraryConfig();
		const { database } = await getReaderAuthForConfig(config);
		const { cookies } = await mintReaderSessionCookiesIn(database as never, { secret: config.authentication.secret, libraryBaseUrl: config.identity.baseUrl }, PEOPLE[signin].id, { name: PEOPLE[signin].name, cookieDomain: "localhost" });
		for (const cookie of cookies) response.cookies.set(cookie.name, cookie.value, { path: "/", maxAge: DAY, secure: true, httpOnly: true, sameSite: "lax" });
	}
	return response;
}
