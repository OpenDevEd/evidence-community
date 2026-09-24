import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/db";
import { getLibraryConfig } from "@/config/library-config/server";
import { readTopicDetail } from "@/lib/topics/catalog";
import { topicIdSchema } from "@/lib/topics/contract";

export async function GET(request: NextRequest) {
  const config = await getLibraryConfig();
  const headers = {"Cache-Control": "no-store"};
  if (!config.topics.enabled) return NextResponse.json({error: {code: "topics_disabled", retryable: false}}, {status: 404, headers});
  const id = topicIdSchema.safeParse(request.nextUrl.searchParams.get("topicId"));
  if (!id.success) return NextResponse.json({error: {code: "invalid_input", retryable: false}}, {status: 400, headers});
  try { return NextResponse.json(await readTopicDetail(id.data, {database: await getDatabase(), config}), {headers}); }
  catch (error) {
    console.error("Topic detail request failed", {topicId: id.data, error});
    return NextResponse.json({error: {code: "topics_unavailable", retryable: true}}, {status: 503, headers});
  }
}
