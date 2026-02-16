import { NextRequest, NextResponse } from "next/server";
import { ItemsGetResponse } from "./types";
import { defaultParams } from "@/lib/utils";
import { getPublicItems } from "@/lib/search";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

export async function GET(request: NextRequest) {
	const url = new URL(request.url);
	const queryParams = defaultParams(url.searchParams);
	const includeHeavyFields = url.searchParams.get("includeHeavyFields") === "true";
	const res = await getPublicItems(queryParams, { includeHeavyFields });
	return NextResponse.json<ItemsGetResponse>(res, {
		headers: {
			"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
		},
	});
}
