import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { getRedirect } from "@/lib/redirects";

export async function GET(
	_request: NextRequest,
	props: { params: Promise<{ key: string }> }
) {
	const params = await props.params;
	const itemKey = decodeURIComponent(params.key);

	const redirects = await getRedirect(itemKey);

	return NextResponse.json(redirects, {
		status: 200,
		headers: {
			"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
		},
	});
}
