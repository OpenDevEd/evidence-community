import type { NextRequest } from "next/server";
import { handleAdminPdfObjectRequest } from "@/lib/admin/file-cover-query";

export function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ key: string }> },
) {
	return handleAdminPdfObjectRequest(request, params, "cover");
}
