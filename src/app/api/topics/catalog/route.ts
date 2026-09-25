import { NextRequest } from "next/server";
import { parseTopicCatalogParams, readTopicCatalog } from "@/lib/topics/catalog";
import { topicResponse } from "@/lib/topics/route-response";

export async function GET(request: NextRequest) {
  return topicResponse(config => parseTopicCatalogParams(request.nextUrl.searchParams, config.authentication.openScholar.libraryId), readTopicCatalog,
    (_input, config) => ["Topic catalog request failed", {libraryId: config.authentication.openScholar.libraryId}]);
}
