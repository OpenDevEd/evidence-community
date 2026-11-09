import { connection, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { adminRoleOf } from "@/lib/admin/access";
import { getSignedInOpenScholarUser } from "@/lib/readers/session";

/**
 * Whether the signed-in reader has a role in this library above viewer, read again when their account menu opens: an
 * application accepted since the page loaded turns Join this team into Admin without a reload. OpenScholar's answer is
 * reused for about a minute (../../../../lib/admin/access.ts).
 */
export async function GET(request: Request) {
	// Each answer belongs to one signed-in reader, so none is prerendered at build time.
	await connection();
	const config = await getLibraryConfig();
	const reader = await getSignedInOpenScholarUser(request.headers, config);
	const admin = reader ? (await adminRoleOf(config, reader.clerkUserId)) !== null : false;
	return NextResponse.json({ admin }, { headers: { "Cache-Control": "no-store" } });
}
