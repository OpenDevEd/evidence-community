import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_LIBRARY_PERMISSION } from "@/lib/admin/access";
import { forgetStaleValues } from "@/lib/stale-while-revalidate";
import { ADMIN_RESPONSE_HEADERS, handleAdminResponse } from "@/lib/admin/http";

// Every cached public record carries the "library" tag, and the layout's counts
// and the home page's figures are kept in memory. Their keys already change with
// each published change, so this is for memory or a page that looks wrong.
export function DELETE(request: NextRequest) {
	return handleAdminResponse(request, ADMIN_LIBRARY_PERMISSION, async (session) => {
		revalidateTag("library", { expire: 0 });
		forgetStaleValues();
		console.info("Public cache cleared", { adminId: session.clerkUserId, role: session.role, at: new Date().toISOString() });
		return new NextResponse(null, { status: 204, headers: ADMIN_RESPONSE_HEADERS });
	});
}
