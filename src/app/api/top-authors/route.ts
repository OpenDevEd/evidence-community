import { NextRequest, NextResponse } from "next/server";
import { readPublicRequest } from "@/lib/public-query";
import { resultParams } from "@/lib/searchParams";
import { getTopAuthors } from "@/lib/search";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

/** The sidebar's top authors under the search and filters in the query. Nothing else in the query changes them, or their cache entry. */
export async function GET(request: NextRequest) {
	const query = await readPublicRequest(request);
	if (query instanceof NextResponse) return query;
	return NextResponse.json(await getTopAuthors(resultParams(query.params)), { headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL } });
}
