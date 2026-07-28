import "server-only";

import { PostHog } from "posthog-node";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { RevisionAwareResourceFactory } from "./revision-aware-resource";

export type PostHogConfiguration =
	LibraryServerConfig["analytics"]["posthog"];
export type PostHogClient = Pick<PostHog, "capture" | "shutdown">;
export type PostHogClientFactory = (
	key: string,
	options: {
		flushAt: number;
		flushInterval: number;
		host: string;
	},
) => PostHogClient;

const createPostHogClient: PostHogClientFactory = (key, options) =>
	new PostHog(key, options);

function configurationsEqual(
	left: PostHogConfiguration,
	right: PostHogConfiguration,
) {
	return left.host === right.host && left.key === right.key;
}

export class RevisionAwarePostHogFactory {
	readonly #factory: RevisionAwareResourceFactory<
		PostHogConfiguration,
		PostHogClient | null
	>;

	constructor(clientFactory: PostHogClientFactory = createPostHogClient) {
		this.#factory = new RevisionAwareResourceFactory(
			"PostHog",
			(configuration) => {
				if (!configuration.host || !configuration.key) {
					return { value: null };
				}

				const client = clientFactory(configuration.key, {
					host: configuration.host,
					flushAt: 1,
					flushInterval: 0,
				});
				return {
					value: client,
					dispose: () => Promise.resolve(client.shutdown()),
				};
			},
			{ configurationEquals: configurationsEqual },
		);
	}

	get({
		configuration,
		revision,
		updatedAt,
	}: {
		configuration: PostHogConfiguration;
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
