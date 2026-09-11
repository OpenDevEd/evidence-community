import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { ADMIN_RESPONSE_HEADERS, handleAdminResponse } from "@/lib/admin/http";
import { getNativeFileRuntime } from "@/lib/admin/file-runtime";
import { getAdminPdfCover } from "@/lib/admin/file-cover-query";

const coverRequest = z.object({
	revision: z.coerce.number().int().positive(),
	review: z.string().uuid().optional(),
});

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	return handleAdminResponse(request, ADMIN_CONTENT_PERMISSION, async () => {
		const [{ key }, runtime] = await Promise.all([
			params,
			getNativeFileRuntime(),
		]);
		const { revision, review } = coverRequest.parse(
			Object.fromEntries(request.nextUrl.searchParams),
		);
		const bytes = await getAdminPdfCover(
			runtime.db,
			runtime.storage,
			key,
			revision,
			review,
		);
		return new NextResponse(new Uint8Array(bytes), {
			headers: {
				...ADMIN_RESPONSE_HEADERS,
				"Content-Type": "image/png",
				"X-Content-Type-Options": "nosniff",
			},
		});
	});
}
