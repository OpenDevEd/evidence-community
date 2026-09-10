import { hasMatchingRequestOrigin } from "@/lib/runtime-routing";
import { connection, NextRequest, NextResponse } from "next/server";
import { forwardAuthorProfileRequest } from "@/lib/authors/catalog-server";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { ADMIN_RESPONSE_HEADERS, handleAdminResponse } from "@/lib/admin/http";

export async function POST(request: NextRequest) {
	await connection();
	if (!hasMatchingRequestOrigin(request.nextUrl, request.headers))
		return NextResponse.json(
			{ error: "Invalid request origin" },
			{ status: 403, headers: ADMIN_RESPONSE_HEADERS },
		);
	return handleAdminResponse(
		request,
		ADMIN_CONTENT_PERMISSION,
		async (session) => {
			const body: unknown = await request.json().catch(() => null);
			if (!body || typeof body !== "object" || Array.isArray(body))
				return NextResponse.json(
					{ error: "Invalid request" },
					{ status: 400, headers: ADMIN_RESPONSE_HEADERS },
				);
			return forwardAuthorProfileRequest(body, session.clerkUserId);
		},
	);
}
