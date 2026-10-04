import { NextRequest, NextResponse } from "next/server";
import { FacetsGetResponse } from "./types";
import { getPublicFacets } from "@/lib/search";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { readPublicRequest } from "@/lib/public-query";

export async function GET(request: NextRequest) {
  const query = await readPublicRequest(request);
  if (query instanceof NextResponse) return query;
  const res = await getPublicFacets(query.params);
  return NextResponse.json<FacetsGetResponse>(res, {
    headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL },
  });
}
