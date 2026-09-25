import { NextRequest } from "next/server";
import { readTopicDetail } from "@/lib/topics/catalog";
import { topicIdSchema } from "@/lib/topics/contract";
import { topicResponse } from "@/lib/topics/route-response";

export async function GET(request: NextRequest) {
  return topicResponse(() => topicIdSchema.safeParse(request.nextUrl.searchParams.get("topicId")), readTopicDetail,
    topicId => ["Topic detail request failed", {topicId}]);
}
