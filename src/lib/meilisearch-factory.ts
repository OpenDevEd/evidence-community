import type { Index } from "meilisearch";
import { MeiliSearch } from "meilisearch";

import { RevisionAwareResourceFactory } from "./revision-aware-resource";

const CACHE_INDEX_NAME = "cache";
const REDIRECTS_INDEX_NAME = "redirects";

export type SearchServiceConfiguration = {
	host: string;
	index: string;
	key: string;
};

export type MeilisearchService = {
	cacheIndex: Index;
	index: Index;
	indexName: string;
	redirectsIndex: Index;
};

function configurationsEqual(
	left: SearchServiceConfiguration,
	right: SearchServiceConfiguration,
) {
	return (
		left.host === right.host &&
		left.key === right.key &&
		left.index === right.index
	);
}

function createMeilisearchService(
	configuration: SearchServiceConfiguration,
) {
	const client = new MeiliSearch({
		host: configuration.host,
		apiKey: configuration.key,
	});

	return {
		value: {
			cacheIndex: client.index(CACHE_INDEX_NAME),
			index: client.index(configuration.index),
			indexName: configuration.index,
			redirectsIndex: client.index(REDIRECTS_INDEX_NAME),
		},
	};
}

export class RevisionAwareMeilisearchFactory {
	readonly #factory = new RevisionAwareResourceFactory(
		"Meilisearch",
		createMeilisearchService,
		{
			configurationEquals: configurationsEqual,
		},
	);

	get({
		configuration,
		revision,
		updatedAt,
	}: {
		configuration: SearchServiceConfiguration;
		revision: string;
		updatedAt: string;
	}) {
		return this.#factory.get({
			configuration,
			revision,
			updatedAt,
		});
	}
}
