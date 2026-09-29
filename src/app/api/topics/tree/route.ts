import { getPublicTopicTree } from "@/lib/search";
import { topicResponse } from "@/lib/topics/route-response";

export async function GET() {
  return topicResponse(config => ({success: true, data: config}), getPublicTopicTree,
    (_input, config) => ["Topic tree request failed", {libraryId: config.authentication.openScholar.libraryId}],
    // The browser reuses the tree for five minutes, then shows it while fetching a newer one.
    "public, max-age=300, stale-while-revalidate=86400");
}
