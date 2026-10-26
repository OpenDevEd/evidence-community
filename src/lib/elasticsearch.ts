import "server-only";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { RevisionAwareSearchFactory } from "./elasticsearch-factory";

const globalSearch = globalThis as typeof globalThis & {
	__evidenceLibrarySearchFactory?: RevisionAwareSearchFactory;
};

const searchFactory = globalSearch.__evidenceLibrarySearchFactory ?? new RevisionAwareSearchFactory();

globalSearch.__evidenceLibrarySearchFactory = searchFactory;

/** The library's Elasticsearch: its alias and a client signed in as its login. */
export function getSearchForConfig(config: Pick<LibraryServerConfig, "revision" | "services" | "updatedAt">) {
	const configuration = config.services.search.elasticsearch;
	if (!configuration) throw new Error("This library has no Elasticsearch connection.");
	return searchFactory.get({
		configuration,
		revision: config.revision,
		updatedAt: config.updatedAt,
	});
}
