import { eq } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { status } from "@/db/schema/tables/status";

import { EMBEDDER_TASK_TIMEOUT_MS } from "./consumer";
import type { SearchEmbedderConfiguration } from "./embedder-settings";

/**
 * Decides what the worker records as `lastError` after an outbox pass.
 * A successful batch clears an ordinary indexing error, but a failed embedder
 * stays visible until the next worker start applies it again.
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
 * With an active embedder, every document task also embeds, so the startup
 * rebuild gets the longer embedding wait. Without one, the default applies.
 */
export function resolveRebuildTaskTimeoutMs(input: {
	embedder: SearchEmbedderConfiguration;
}) {
	return input.embedder ? EMBEDDER_TASK_TIMEOUT_MS : undefined;
}

/**
 * When the embedder step failed on an index that already has records, keep
 * those records and leave the rebuild pending: adding documents would need
 * the broken embedder, so every rebuild task would fail. An empty index
 * (brand-new, or created by an earlier worker that stopped) has nothing to
 * lose, so it is still filled.
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

export async function searchIndexRebuildIsPending(database: Database) {
	const [row] = await database
		.select({ pending: status.searchIndexRebuildPending })
		.from(status)
		.where(eq(status.id, 1))
		.limit(1);
	if (!row) throw new Error("Library status row is missing.");
	return row.pending;
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

/** Persist the configuration used by the projection; a failed rebuild stays pending. */
export async function prepareSearchProjection(database: Database, topicsEnabled: boolean) {
  const signature = JSON.stringify({topics: topicsEnabled});
  const [row] = await database.select().from(status).where(eq(status.id, 1)).limit(1);
  if (!row) throw new Error("Library status row is missing.");
  if (row.searchProjectionSignature === signature) return row.searchIndexRebuildPending;
  await database.update(status).set({searchProjectionSignature: signature, searchIndexRebuildPending: true, updatedAt: new Date()}).where(eq(status.id, 1));
  return true;
}
