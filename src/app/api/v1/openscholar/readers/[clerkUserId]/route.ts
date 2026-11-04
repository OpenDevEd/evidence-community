import { NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { ADMIN_RESPONSE_HEADERS } from "@/lib/admin/http";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";
import { deleteReaderByClerkUserId } from "@/lib/readers/data";

/**
 * OpenScholar calls this when an OpenScholar account is deleted. It signs the
 * reader out and removes their bookmarks and collections. 204 when there was
 * a reader, 404 when this library never had one; OpenScholar counts both as
 * done.
 */
export async function DELETE(request: Request, props: { params: Promise<{ clerkUserId: string }> }) {
	const config = await getLibraryConfig();
	const denied = await requireOpenScholarBearer(request, config.authentication.openScholar.machineCredential);
	if (denied) return denied;
	const { clerkUserId } = await props.params;
	if (!clerkUserId || clerkUserId.length > 512) {
		return NextResponse.json({ error: { code: "invalid_request", message: "A Clerk user ID is required." } }, { status: 400, headers: ADMIN_RESPONSE_HEADERS });
	}
	const deleted = await deleteReaderByClerkUserId(await getDatabaseForConfig(config), clerkUserId);
	console.info("Openscholar reader deletion", { libraryId: config.authentication.openScholar.libraryId, clerkUserId, deleted });
	return new NextResponse(null, { status: deleted ? 204 : 404, headers: ADMIN_RESPONSE_HEADERS });
}
