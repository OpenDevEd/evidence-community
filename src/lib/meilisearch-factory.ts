import type { Index } from "meilisearch";
import { Meilisearch } from "meilisearch";

import { RevisionAwareResourceFactory } from "./revision-aware-resource";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export type SearchServiceConfiguration = {
	host: string;
	index: string;
	key: string;
};

export type MeilisearchService = {
	client: Meilisearch;
	index: Index;
	indexName: string;
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
	options: RevisionAwareMeilisearchFactoryOptions,
) {
	const client = new Meilisearch({
		host: configuration.host,
		apiKey: configuration.key,
		timeout: options.requestTimeoutMs,
	});

	return {
		value: {
			client,
			index: client.index(configuration.index),
			indexName: configuration.index,
		},
	};
}

export type RevisionAwareMeilisearchFactoryOptions = {
	requestTimeoutMs?: number;
};

export class RevisionAwareMeilisearchFactory {
	readonly #factory: RevisionAwareResourceFactory<
		SearchServiceConfiguration,
		MeilisearchService
	>;

	constructor(options: RevisionAwareMeilisearchFactoryOptions = {}) {
		const requestTimeoutMs =
			options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		if (
			!Number.isSafeInteger(requestTimeoutMs) ||
			requestTimeoutMs < 100 ||
			requestTimeoutMs > 5 * 60 * 1_000
		) {
			throw new Error(
				"requestTimeoutMs must be an integer between 100 and 300,000",
			);
		}
		const clientOptions = {
			requestTimeoutMs,
		};
		this.#factory = new RevisionAwareResourceFactory(
			"Meilisearch",
			(configuration) =>
				createMeilisearchService(configuration, clientOptions),
			{
				configurationEquals: configurationsEqual,
			},
		);
	}

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
