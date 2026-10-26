import { eq } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { status } from "@/db/schema/tables/status";

import { SEARCH_INDEX_VERSION } from "./elasticsearch-index";

/** What the worker records as `lastError` after an outbox pass: a pass that indexed events clears it. */
export function resolveIdleLastError(input: {
	previousLastError: string | null;
	processedEvents: number;
}) {
	return input.processedEvents > 0 ? null : input.previousLastError;
}

export function shouldRebuildSearchIndex(input: {
	forceRebuild: boolean;
	indexCreated: boolean;
	rebuildPending: boolean;
}) {
	return input.forceRebuild || input.indexCreated || input.rebuildPending;
}

export async function setSearchIndexRebuildPending(
	database: Database,
	pending: boolean,
) {
	const [row] = await database
		.update(status)
		.set({ searchIndexRebuildPending: pending, updatedAt: new Date() })
		.where(eq(status.id, 1))
		.returning({ pending: status.searchIndexRebuildPending });
	if (!row) throw new Error("Library status row is missing.");
	return row.pending;
}

/**
 * Bump when the documents the projection stores change (a field, a label, a
 * format), so every library rebuilds once when it runs the new code. Without
 * it, records keep what an older runtime stored until they are edited. A new
 * Elasticsearch index definition (`SEARCH_INDEX_VERSION`) rebuilds the same way.
 */
const SEARCH_PROJECTION_VERSION = 11;

/** Persist the configuration used by the projection; a failed rebuild stays pending. */
export async function prepareSearchProjection(database: Database, topicsEnabled: boolean, fullTextSearch: boolean, hiddenTags: readonly string[]) {
  // Page text is indexed only with full-text search, and hidden tags decide `hasPdf`; changing either rebuilds.
  const signature = JSON.stringify({version: SEARCH_PROJECTION_VERSION, index: SEARCH_INDEX_VERSION, topics: topicsEnabled, ...(fullTextSearch ? {} : {fullText: false}), hiddenTags: [...hiddenTags].sort()});
  const [row] = await database.select().from(status).where(eq(status.id, 1)).limit(1);
  if (!row) throw new Error("Library status row is missing.");
  if (row.searchProjectionSignature === signature) return row.searchIndexRebuildPending;
  await database.update(status).set({searchProjectionSignature: signature, searchIndexRebuildPending: true, updatedAt: new Date()}).where(eq(status.id, 1));
  return true;
}
