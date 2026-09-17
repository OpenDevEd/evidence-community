import { connection, NextRequest, NextResponse } from "next/server";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { ADMIN_RESPONSE_HEADERS, handleAdminResponse } from "@/lib/admin/http";
import {
	openAlexInstitutionQuerySchema,
	searchOpenAlexInstitutions,
} from "@/lib/admin/institution-countries";

export async function GET(request: NextRequest) {
	await connection();
	return handleAdminResponse(request, ADMIN_CONTENT_PERMISSION, async () => {
		const query = openAlexInstitutionQuerySchema.parse(
			request.nextUrl.searchParams.get("query") ?? "",
		);
		try {
			return NextResponse.json(
				{ items: await searchOpenAlexInstitutions(query, request.signal) },
				{ headers: ADMIN_RESPONSE_HEADERS },
			);
		} catch (error) {
			// The selector still works from the library's own names.
			console.error("OpenAlex institution search failed", { query, error });
			return NextResponse.json(
				{
					error: {
						code: "internal_error",
						message: "OpenAlex could not be reached.",
					},
				},
				{ status: 502, headers: ADMIN_RESPONSE_HEADERS },
			);
		}
	});
}
