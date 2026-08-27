import "server-only";

import { PostHog } from "posthog-node";

let client: PostHog | null | undefined;

export function getPostHogClient() {
	if (client !== undefined) return client;

	const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
	const host = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();
	if (!key || !host) {
		client = null;
		return client;
	}

	client = new PostHog(key, {
		host,
		flushAt: 20,
		flushInterval: 10_000,
		featureFlagsPollingInterval: 30_000,
	});
	return client;
}
