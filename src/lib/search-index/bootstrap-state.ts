import { eq } from "drizzle-orm";

import type { SearchEngineName } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { status } from "@/db/schema/tables/status";

import { SEARCH_INDEX_VERSION } from "./elasticsearch-index";

/**
 * Decides what the worker records as `lastError` after an outbox pass. A successful batch clears an ordinary indexing
 * error, but a failed Meilisearch embedder stays visible until the next worker start applies it again.
 */
export function resolveIdleLastError(input: {
	embedderError: string | null;
	previousLastError: string | null;
	processedEvents: number;
}) {
	if (input.processedEvents > 0) return input.embedderError;
	return input.previousLastError ?? input.embedderError;
}

/**
 * When the embedder step failed on an index that already has records, keep those records and leave the rebuild
 * pending: adding documents would need the broken embedder, so every rebuild task would fail. An empty index
 * (brand-new, or created by an earlier worker that stopped) has nothing to lose, so it is still filled.
 */
export function shouldRebuildSearchIndex(input: {
	embedderError?: string | null;
	forceRebuild: boolean;
	indexCreated: boolean;
	indexHasRecords?: boolean;
	rebuildPending: boolean;
}) {
	if (input.embedderError && input.indexHasRecords) return false;
	return input.forceRebuild || input.indexCreated || input.rebuildPending;
}

/** How long a reader process trusts the engine it last read; a switch reaches every reader within this. */
export const LIVE_ENGINE_TTL_MS = 5_000;

/**
 * Readers that read the engine or index just before it moved keep searching the old index until their cache expires,
 * and a search they started may still be running. An old index stays this long after readers move.
 */
export const OLD_INDEX_GRACE_MS = 2 * LIVE_ENGINE_TTL_MS;

/** The engine whose index holds every record, which readers search; null before the library's first build. */
export async function readSearchEngine(database: Database): Promise<SearchEngineName | null> {
	const [row] = await database.select({ engine: status.searchEngine }).from(status).where(eq(status.id, 1)).limit(1);
	if (!row) throw new Error("Library status row is missing.");
	return row.engine;
}

/** Moves the library's readers to `engine`, once its index holds every record. */
export async function setSearchEngine(database: Database, engine: SearchEngineName) {
	const [row] = await database
		.update(status)
		.set({ searchEngine: engine, updatedAt: new Date() })
		.where(eq(status.id, 1))
		.returning({ engine: status.searchEngine });
	if (!row) throw new Error("Library status row is missing.");
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
 * Elasticsearch index definition (`SEARCH_INDEX_VERSION`) rebuilds a library on
 * Elasticsearch the same way; a library on Meilisearch keeps main's signature.
 */
const SEARCH_PROJECTION_VERSION = 13;

/**
 * Persist the configuration used by the projection; a failed rebuild stays pending. In Elasticsearch, another embedder
 * (`embedder`, its fingerprint) rebuilds too: each record gets the new embedder's vector, or none without one.
 */
export async function prepareSearchProjection(database: Database, engine: SearchEngineName, topicsEnabled: boolean, fullTextSearch: boolean, hiddenTags: readonly string[], embedder: string | null = null) {
  // Page text is indexed only with full-text search, and hidden tags decide `hasPdf`; changing either rebuilds.
  const signature = JSON.stringify({version: SEARCH_PROJECTION_VERSION, ...(engine === "elasticsearch" ? {index: SEARCH_INDEX_VERSION, ...(embedder ? {embedder} : {})} : {}), topics: topicsEnabled, ...(fullTextSearch ? {} : {fullText: false}), hiddenTags: [...hiddenTags].sort()});
  const [row] = await database.select().from(status).where(eq(status.id, 1)).limit(1);
  if (!row) throw new Error("Library status row is missing.");
  if (row.searchProjectionSignature === signature) return row.searchIndexRebuildPending;
  await database.update(status).set({searchProjectionSignature: signature, searchIndexRebuildPending: true, updatedAt: new Date()}).where(eq(status.id, 1));
  return true;
}
