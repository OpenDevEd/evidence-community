import { setTimeout as delay } from "node:timers/promises";

import type { LibraryServerConfig, SearchEngineName } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";

import { LIVE_ENGINE_TTL_MS, setSearchEngine } from "./bootstrap-state";
import { rebuildSearchIndex } from "./consumer";
import { openSearchWriter } from "./engine-setup";
import type { SearchIndexWriter } from "./writer";

type Rebuilt = Awaited<ReturnType<typeof rebuildSearchIndex>>;

/**
 * Readers that read the engine just before it moved keep searching the old index until their cache expires, and a
 * search they started may still be running. The old index stays this long after readers move.
 */
const OLD_INDEX_GRACE_MS = 2 * LIVE_ENGINE_TTL_MS;

/** Deletes the old engine's index once readers left it; a failure leaves an unused index, not a broken library. */
async function removeOldIndex(config: LibraryServerConfig, engine: SearchEngineName, signal: AbortSignal) {
	if (!config.services.search[engine]) return false;
	await delay(OLD_INDEX_GRACE_MS, undefined, { signal });
	try {
		await (await openSearchWriter(config, engine)).writer.remove(signal);
		return true;
	} catch (error) {
		console.error(`Search index: deleting the library's ${engine} index failed: ${error instanceof Error ? error.message : String(error)}`);
		return false;
	}
}

/**
 * Brings the library's readers onto the engine its configuration chooses (OpenDevEd/new-el#722). On a switch, the
 * configured engine's index is built while readers keep the old engine; then readers move, and the old index is
 * deleted, since only the chosen engine is kept current. Otherwise the index is rebuilt when `rebuild` says so, and a
 * library's first complete index records its engine.
 */
export async function settleSearchEngine(input: {
	config: LibraryServerConfig;
	database: Database;
	/** The engine readers search now, or null before the library's first complete index. */
	live: SearchEngineName | null;
	rebuild: boolean;
	/** The configured engine's embedder failed while its index holds records a rebuild would lose. */
	embedderBlocksRebuild: boolean;
	signal: AbortSignal;
	taskTimeoutMs: number;
	writer: SearchIndexWriter;
}): Promise<{ rebuilt: Rebuilt | null; switchedFrom: SearchEngineName | null; oldIndexRemoved: boolean }> {
	const { config, database, live, signal, writer } = input;
	const switching = live !== null && live !== writer.engine;
	if (switching && input.embedderBlocksRebuild) {
		console.error(`Search index: the switch to ${writer.engine} waits for its embedder; readers stay on ${live}.`);
		return { rebuilt: null, switchedFrom: null, oldIndexRemoved: false };
	}
	const rebuilt = switching || input.rebuild ? await rebuildSearchIndex(database, writer, config, { signal, taskTimeoutMs: input.taskTimeoutMs }) : null;
	if (live !== writer.engine) await setSearchEngine(database, writer.engine);
	const oldIndexRemoved = switching ? await removeOldIndex(config, live, signal) : false;
	return { rebuilt, switchedFrom: switching ? live : null, oldIndexRemoved };
}
