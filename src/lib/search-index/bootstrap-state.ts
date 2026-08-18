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
	embedderError: string | null;
}) {
	return input.embedder && !input.embedderError
		? EMBEDDER_TASK_TIMEOUT_MS
		: undefined;
}

export function shouldRebuildSearchIndex(input: {
	forceRebuild: boolean;
	indexCreated: boolean;
	rebuildPending: boolean;
}) {
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
