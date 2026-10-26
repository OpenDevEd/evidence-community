import "server-only";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getSearchForConfig } from "@/lib/elasticsearch";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import type { SearchEngine } from "@/lib/search-engine";

import { elasticsearchEngine } from "./elasticsearch";
import { readLiveSearchEngine } from "./live-engine";
import { meilisearchEngine } from "./meilisearch";

/** One engine per client, so what an engine keeps between searches lasts as long as its client. */
const engines = new WeakMap<object, SearchEngine>();

function engineFor<S extends object>(service: S, create: (service: S) => SearchEngine) {
	let engine = engines.get(service);
	if (!engine) {
		engine = create(service);
		engines.set(service, engine);
	}
	return engine;
}

/**
 * The engine a library's readers search (OpenDevEd/new-el#722): the one whose index holds every record. While a switch
 * builds the configured engine's index, readers keep the old engine; before the first build, and when the old engine
 * has no connection left, they search the configured one.
 */
export async function getSearchEngine(config: Pick<LibraryServerConfig, "revision" | "services" | "updatedAt">): Promise<SearchEngine> {
	const live = await readLiveSearchEngine(config);
	const engine = live && config.services.search[live] ? live : config.services.search.engine;
	return engine === "meilisearch"
		? engineFor(await getMeilisearchForConfig(config), meilisearchEngine)
		: engineFor(await getSearchForConfig(config), elasticsearchEngine);
}
