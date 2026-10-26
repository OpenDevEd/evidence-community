import "server-only";

import type { LibraryServerConfig, SearchEngineName } from "@/config/library-config/schema";
import { getDatabaseForConfig } from "@/db";
import { LIVE_ENGINE_TTL_MS, readSearchEngine } from "@/lib/search-index/bootstrap-state";

const recent = new Map<string, { at: number; engine: Promise<SearchEngineName | null> }>();

/**
 * The engine whose index holds every one of the library's records, as its search worker last recorded it
 * (OpenDevEd/new-el#722), read at most every few seconds per process. Null before the library's first build, or
 * when the status can't be read and was never read: readers then search the engine the configuration chooses. A
 * failed read keeps the engine read before, which may be mid-switch, where the configured one is still being built.
 */
export function readLiveSearchEngine(config: Pick<LibraryServerConfig, "revision" | "services" | "updatedAt">) {
	const key = config.services.database.url;
	const cached = recent.get(key);
	if (cached && Date.now() - cached.at < LIVE_ENGINE_TTL_MS) return cached.engine;
	const engine = (async () => readSearchEngine(await getDatabaseForConfig(config)))().catch((error: unknown) => {
		console.warn(`Search: reading the library's live search engine failed. ${error instanceof Error ? error.message : String(error)}`);
		return cached?.engine ?? null;
	});
	recent.set(key, { at: Date.now(), engine });
	return engine;
}
