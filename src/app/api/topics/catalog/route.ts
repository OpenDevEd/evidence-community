import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/db";
import { getLibraryConfig } from "@/config/library-config/server";
import { readTopicCatalog } from "@/lib/topics/catalog";
import { topicCatalogRequestSchema } from "@/lib/topics/contract";

export async function GET(request: NextRequest) {
  const config = await getLibraryConfig();
  const headers = {"Cache-Control": "no-store"};
  if (!config.topics.enabled) return NextResponse.json({error: {code: "topics_disabled", retryable: false}}, {status: 404, headers});
  const params = request.nextUrl.searchParams;
  const input = topicCatalogRequestSchema.safeParse({contractVersion: 1, libraryId: config.authentication.openScholar.libraryId,
    ...(params.has("ids") ? {ids: params.get("ids")!.split(",")} : params.has("query") ? {query: params.get("query")} : {parent: params.get("parent") || null}),
    cursor: params.get("cursor"), limit: params.has("limit") ? Number(params.get("limit")) : 100,
  });
  if (!input.success) return NextResponse.json({error: {code: "invalid_input", retryable: false}}, {status: 400, headers});
  try { return NextResponse.json(await readTopicCatalog(input.data, {database: await getDatabase(), config}), {headers}); }
  catch (error) {
    console.error("Topic catalog request failed", {libraryId: config.authentication.openScholar.libraryId, error});
    return NextResponse.json({error: {code: "topics_unavailable", retryable: true}}, {status: 503, headers});
  }
}
