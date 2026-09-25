import { NextResponse } from "next/server";
import { getDatabase } from "@/db";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { TopicServiceError, type TopicCatalogContext } from "./catalog";

const headers = {"Cache-Control": "no-store"};

function topicError(code: string, status: number, retryable = false) {
  return NextResponse.json({error: {code, retryable}}, {status, headers});
}

function topicFailure(error: unknown, [message, details]: [string, Record<string, unknown>]) {
  if (error instanceof TopicServiceError && error.status === 404) return topicError("topic_not_found", 404);
  console.error(message, {...details, error});
  return topicError("topics_unavailable", 503, true);
}

/** Shared status codes and no-store caching for the public topic routes. */
export async function topicResponse<T>(
  parse: (config: LibraryServerConfig) => {success: true; data: T} | {success: false},
  read: (input: T, context: TopicCatalogContext) => Promise<unknown>,
  failure: (input: T, config: LibraryServerConfig) => [string, Record<string, unknown>],
) {
  const config = await getLibraryConfig();
  if (!config.topics.enabled) return topicError("topics_disabled", 404);
  const input = parse(config);
  if (!input.success) return topicError("invalid_input", 400);
  try { return NextResponse.json(await read(input.data, {database: await getDatabase(), config}), {headers}); }
  catch (error) { return topicFailure(error, failure(input.data, config)); }
}
