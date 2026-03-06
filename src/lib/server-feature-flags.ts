import "server-only";

import { createHash } from "node:crypto";
import { cacheLife } from "next/cache";
import posthogClient from "@/lib/posthog";
import {
	FEATURE_FLAG_KEYS,
	getFallbackFeatureFlags,
	normalizeFeatureFlags,
} from "@/lib/feature-flags";

function getAnonymousFeatureFlagsDistinctId() {
	const deploymentScope =
		process.env.BASE_URL ||
		process.env.VERCEL_PROJECT_PRODUCTION_URL ||
		process.env.VERCEL_URL ||
		process.env.MEILI_INDEX ||
		"default";

	return `server-flags:${createHash("sha256")
		.update(deploymentScope)
		.digest("hex")
		.slice(0, 32)}`;
}

export async function getServerFeatureFlags() {
	"use cache";
	cacheLife({ revalidate: 300 });

	if (
		!process.env.NEXT_PUBLIC_POSTHOG_KEY ||
		!process.env.NEXT_PUBLIC_POSTHOG_HOST
	) {
		return getFallbackFeatureFlags();
	}

	try {
		const result = await posthogClient.getAllFlagsAndPayloads(
			getAnonymousFeatureFlagsDistinctId(),
			{
				disableGeoip: true,
				flagKeys: [...FEATURE_FLAG_KEYS],
			}
		);

		return normalizeFeatureFlags(result.featureFlags);
	} catch (error) {
		console.error("Failed to fetch PostHog feature flags:", error);
		return getFallbackFeatureFlags();
	}
}
