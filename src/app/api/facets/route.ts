import { NextRequest, NextResponse } from "next/server";
import { FacetsGetResponse } from "./types";
import { defaultParams } from "@/lib/utils";
import { getPublicFacets } from "@/lib/search";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const queryParams = defaultParams(url.searchParams);
  const res = await getPublicFacets(queryParams);
  return NextResponse.json<FacetsGetResponse>(res, {
    headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL },
  });
}
