import { setTimeout as delay } from "node:timers/promises";

import type { LibraryServerConfig, SearchEngineName } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";

import { OLD_INDEX_GRACE_MS, setSearchEngine, setSearchIndexRebuildPending } from "./bootstrap-state";
import { rebuildSearchIndex } from "./consumer";
import { openSearchWriter } from "./engine-setup";
import type { SearchIndexWriter } from "./writer";

type Rebuilt = Awaited<ReturnType<typeof rebuildSearchIndex>>;

type SettleInput = {
	config: LibraryServerConfig;
	database: Database;
	/** The engine readers search now, or null before the library recorded one. */
	live: SearchEngineName | null;
	rebuild: boolean;
	/** The configured engine's embedder failed while its index holds records a rebuild would lose. */
	embedderBlocksRebuild: boolean;
	signal: AbortSignal;
	taskTimeoutMs: number;
	writer: SearchIndexWriter;
};

export type SettledEngine = {
	rebuilt: Rebuilt | null;
	switchedFrom: SearchEngineName | null;
	oldIndexRemoved: boolean;
	/** The engine readers search once this returns, which the worker keeps current: the old one while a switch waits. */
	readersOn: SearchEngineName;
};

function otherEngine(engine: SearchEngineName): SearchEngineName {
	return engine === "elasticsearch" ? "meilisearch" : "elasticsearch";
}

async function holdsRecords(config: LibraryServerConfig, engine: SearchEngineName) {
	return Boolean(config.services.search[engine]) && (await openSearchWriter(config, engine)).hasRecords();
}

/** Deletes the old engine's index once readers left it; a failure leaves an unused index, not a broken library. */
async function removeOldIndex(config: LibraryServerConfig, engine: SearchEngineName, signal: AbortSignal) {
	if (!config.services.search[engine]) return false;
	// A stop during the wait leaves the index for the next start to delete.
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
 * Deletes an old index a stopped switch left behind. An engine the library doesn't search can be unreachable; that
 * leaves the index for a later start rather than stopping the worker.
 */
async function removeLeftover(input: SettleInput) {
	const leftover = otherEngine(input.writer.engine);
	const holds = await holdsRecords(input.config, leftover).catch((error: unknown) => {
		console.error(`Search index: checking for an old ${leftover} index failed: ${error instanceof Error ? error.message : String(error)}`);
		return false;
	});
	return holds && removeOldIndex(input.config, leftover, input.signal);
}

async function rebuild(input: SettleInput) {
	const rebuilt = await rebuildSearchIndex(input.database, input.writer, input.config, { signal: input.signal, taskTimeoutMs: input.taskTimeoutMs });
	await setSearchIndexRebuildPending(input.database, false);
	return rebuilt;
}

/**
 * A library from before engines were recorded searched the engine its old configuration named. When the other engine
 * holds the library's records, readers stay there until the configured engine's index is built.
 */
async function recordedOrExisting(input: SettleInput) {
	if (input.live !== null) return input.live;
	const other = otherEngine(input.writer.engine);
	if (!(await holdsRecords(input.config, other))) return null;
	await setSearchEngine(input.database, other);
	return other;
}

async function switchEngine(input: SettleInput, live: SearchEngineName): Promise<SettledEngine> {
	const target = input.writer.engine;
	const liveConnected = Boolean(input.config.services.search[live]);
	if (!liveConnected) {
		console.warn(`Search index: readers search the ${target} index while it is built, as the configuration has no ${live} connection left.`);
	}
	if (input.embedderBlocksRebuild) {
		console.error(`Search index: the switch to ${target} waits for its embedder; readers stay on ${live}.`);
		return { rebuilt: null, switchedFrom: null, oldIndexRemoved: false, readersOn: liveConnected ? live : target };
	}
	const rebuilt = await rebuild(input);
	await setSearchEngine(input.database, target);
	return { rebuilt, switchedFrom: live, oldIndexRemoved: await removeOldIndex(input.config, live, input.signal), readersOn: target };
}

/**
 * Brings the library's readers onto the engine its configuration chooses (OpenDevEd/new-el#722). On a switch, the
 * configured engine's index is built while readers keep the old engine; then readers move, and the old index is
 * deleted, since only the chosen engine is kept current. Otherwise the index is rebuilt when `rebuild` says so, a
 * library's first complete index records its engine, and an old index a stopped switch left behind is deleted.
 */
export async function settleSearchEngine(input: SettleInput): Promise<SettledEngine> {
	const target = input.writer.engine;
	const live = await recordedOrExisting(input);
	if (live !== null && live !== target) return switchEngine(input, live);
	const rebuilt = input.rebuild ? await rebuild(input) : null;
	if (live !== target) await setSearchEngine(input.database, target);
	return { rebuilt, switchedFrom: null, oldIndexRemoved: await removeLeftover(input), readersOn: target };
}
