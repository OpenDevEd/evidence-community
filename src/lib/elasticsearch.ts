import "server-only";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { RevisionAwareSearchFactory } from "./elasticsearch-factory";

const globalSearch = globalThis as typeof globalThis & {
	__evidenceLibrarySearchFactory?: RevisionAwareSearchFactory;
};

const searchFactory = globalSearch.__evidenceLibrarySearchFactory ?? new RevisionAwareSearchFactory();

globalSearch.__evidenceLibrarySearchFactory = searchFactory;

export function getSearchForConfig(config: Pick<LibraryServerConfig, "revision" | "services" | "updatedAt">) {
	return searchFactory.get({
		configuration: config.services.search,
		revision: config.revision,
		updatedAt: config.updatedAt,
	});
}
