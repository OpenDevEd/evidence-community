import "server-only";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import {
	RevisionAwareMeilisearchFactory,
	type MeilisearchService,
} from "./meilisearch-factory";

const globalMeilisearch = globalThis as typeof globalThis & {
	__evidenceLibraryMeilisearchFactory?: RevisionAwareMeilisearchFactory;
};

const meilisearchFactory =
	globalMeilisearch.__evidenceLibraryMeilisearchFactory ??
	new RevisionAwareMeilisearchFactory();

globalMeilisearch.__evidenceLibraryMeilisearchFactory =
	meilisearchFactory;

export function getMeilisearchForConfig(
	config: Pick<
		LibraryServerConfig,
		"revision" | "services" | "updatedAt"
	>,
) {
	const configuration = config.services.search.meilisearch;
	if (!configuration) throw new Error("This library has no Meilisearch connection.");
	return meilisearchFactory.get({
		configuration,
		revision: config.revision,
		updatedAt: config.updatedAt,
	});
}

export type { MeilisearchService };
