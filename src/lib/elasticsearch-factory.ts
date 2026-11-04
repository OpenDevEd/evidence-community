import { Client } from "@elastic/elasticsearch";

import { RevisionAwareResourceFactory } from "./revision-aware-resource";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

type SearchServiceConfiguration = {
	host: string;
	index: string;
	key: string;
};

/**
 * A library's search on the shared Elasticsearch: a client signed in as the library's login, and the alias its
 * records are written and read through. The database provisioner names the login after the alias and limits it
 * to that alias and the indexes behind it (OpenDevEd/new-el#718).
 */
export type SearchService = {
	alias: string;
	client: Client;
};

function createSearchService(
	configuration: SearchServiceConfiguration,
	requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): SearchService {
	return {
		alias: configuration.index,
		client: new Client({
			node: configuration.host,
			auth: { username: configuration.index, password: configuration.key },
			requestTimeout: requestTimeoutMs,
			maxRetries: 2,
		}),
	};
}

function configurationsEqual(left: SearchServiceConfiguration, right: SearchServiceConfiguration) {
	return left.host === right.host && left.key === right.key && left.index === right.index;
}

/** One search client per configuration revision; a new revision with other search settings replaces it. */
export class RevisionAwareSearchFactory {
	readonly #factory: RevisionAwareResourceFactory<SearchServiceConfiguration, SearchService>;

	constructor(options: { requestTimeoutMs?: number } = {}) {
		const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 5 * 60 * 1_000) {
			throw new Error("requestTimeoutMs must be an integer between 100 and 300,000");
		}
		this.#factory = new RevisionAwareResourceFactory(
			"Elasticsearch",
			(configuration) => {
				const service = createSearchService(configuration, requestTimeoutMs);
				return { value: service, dispose: () => service.client.close() };
			},
			{ configurationEquals: configurationsEqual },
		);
	}

	get(input: { configuration: SearchServiceConfiguration; revision: string; updatedAt: string }) {
		return this.#factory.get(input);
	}
}
