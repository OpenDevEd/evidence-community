import { NextRequest, NextResponse } from "next/server";
import { ItemsGetResponse } from "./types";
import { getPublicItems } from "@/lib/search";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { readPublicRequest } from "@/lib/public-query";

export async function GET(request: NextRequest) {
	const query = await readPublicRequest(request, {
		paged: true,
		perPage: true,
		includeHeavyFields: true,
	});
	if (query instanceof NextResponse) return query;
	const res = await getPublicItems(query.params, {
		includeHeavyFields: query.includeHeavyFields,
		perPage: query.perPage,
	});
	return NextResponse.json<ItemsGetResponse>(res, {
		headers: {
			"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
		},
	});
}
