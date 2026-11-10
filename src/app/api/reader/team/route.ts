import { cookies } from "next/headers";
import { connection, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { adminRoleOf } from "@/lib/admin/access";
import { joinStandingOf, MOCK_JOIN_COOKIE } from "@/lib/readers/join";
import { getSignedInOpenScholarUser } from "@/lib/readers/session";

/**
 * Whether the signed-in reader has a role in this library above viewer, and where they stand with joining its team,
 * read again when their account menu opens: an application sent or accepted since the page loaded shows without a
 * reload. OpenScholar's answer is reused for about a minute (../../../../lib/admin/access.ts).
 */
export async function GET(request: Request) {
	// Each answer belongs to one signed-in reader, so none is prerendered at build time.
	await connection();
	const config = await getLibraryConfig();
	const reader = await getSignedInOpenScholarUser(request.headers, config);
	const admin = reader ? (await adminRoleOf(config, reader.clerkUserId)) !== null : false;
	// MOCK: Openscholar answers this beside the role once its route exists.
	const join = joinStandingOf((await cookies()).get(MOCK_JOIN_COOKIE)?.value);
	return NextResponse.json({ admin, join }, { headers: { "Cache-Control": "no-store" } });
}
