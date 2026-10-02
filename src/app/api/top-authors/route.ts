import { NextRequest, NextResponse } from "next/server";
import { defaultParams } from "@/lib/utils";
import { getTopAuthors } from "@/lib/search";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

/** The sidebar's top authors under the search and filters in the query. Pages and order don't change them. */
export async function GET(request: NextRequest) {
	const { page, sort, ...filters } = defaultParams(new URL(request.url).searchParams);
	return NextResponse.json(await getTopAuthors(filters), { headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL } });
}
