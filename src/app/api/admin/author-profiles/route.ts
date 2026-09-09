import { hasMatchingRequestOrigin } from "@/lib/runtime-routing";
import { connection, NextRequest, NextResponse } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { ADMIN_RESPONSE_HEADERS, readAdminPermission } from "@/lib/admin/http";

export async function POST(request: NextRequest) {
	await connection();
	if (!hasMatchingRequestOrigin(request.nextUrl, request.headers)) return NextResponse.json({error: "Invalid request origin"}, {status: 403, headers: ADMIN_RESPONSE_HEADERS});
	const access = await readAdminPermission(request, ADMIN_CONTENT_PERMISSION);
	if (access.denied) return access.denied;
	const body: unknown = await request.json().catch(() => null);
	if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({error: "Invalid request"}, {status: 400, headers: ADMIN_RESPONSE_HEADERS});
	const service = (await getLibraryConfig()).authentication.openScholar;
	try {
		const response = await fetch(new URL("/api/v1/evidence-libraries/author-profiles", service.convexSiteUrl), {
			method: "POST", headers: {"Content-Type": "application/json", Authorization: `Bearer ${service.machineCredential}`},
			body: JSON.stringify({...body, libraryId: service.libraryId, clerkUserId: access.session.clerkUserId}),
			signal: AbortSignal.timeout(10000), cache: "no-store",
		});
		const result = await response.json();
		return NextResponse.json({...result, profileBaseUrl: new URL(service.loginPageUrl).origin}, {status: response.status, headers: ADMIN_RESPONSE_HEADERS});
	} catch (error) {
		console.error("Author profile catalog request failed", {libraryId: service.libraryId, error});
		return NextResponse.json({error: "Author profiles are unavailable. Try again shortly."}, {status: 503, headers: ADMIN_RESPONSE_HEADERS});
	}
}
