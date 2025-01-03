import { NextRequest, NextResponse } from "next/server";
import { ItemsGetResponse } from "./types";
import { searchIndex } from "@/lib/actions";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const collections = searchParams.get("collections")?.split(",") || [];

  const res = await searchIndex(request, {
    facets: ["collections"],
    filter: [
      ...collections.map(collection => `collections = "${collection}"`),
    ],
  });

  return NextResponse.json<ItemsGetResponse>(res);
}
