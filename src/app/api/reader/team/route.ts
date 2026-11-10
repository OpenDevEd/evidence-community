import { connection, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { teamStandingOf } from "@/lib/readers/join-standing";
import { getSignedInOpenScholarUser } from "@/lib/readers/session";

/**
 * Whether the signed-in reader has a role in this library above viewer, and where they stand with joining its team,
 * read again when their account menu opens or the window comes back into focus: an application sent or accepted since
 * the page loaded shows without a reload. The role is OpenScholar's answer of the last minute
 * (../../../../lib/admin/access.ts); the standing is asked now, since a reader coming back from applying expects it.
 */
export async function GET(request: Request) {
	// Each answer belongs to one signed-in reader, so none is prerendered at build time.
	await connection();
	const config = await getLibraryConfig();
	const reader = await getSignedInOpenScholarUser(request.headers, config);
	return NextResponse.json(await teamStandingOf(config, reader, { fresh: true }), { headers: { "Cache-Control": "no-store" } });
}
