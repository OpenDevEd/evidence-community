import { NextRequest, NextResponse } from "next/server";
import { defaultParams } from "@/lib/utils";
import { resultParams } from "@/lib/searchParams";
import { getTopAuthors } from "@/lib/search";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

/** The sidebar's top authors under the search and filters in the query. Nothing else in the query changes them, or their cache entry. */
export async function GET(request: NextRequest) {
	const filters = resultParams(defaultParams(new URL(request.url).searchParams));
	return NextResponse.json(await getTopAuthors(filters), { headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL } });
}
