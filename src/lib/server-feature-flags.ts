import "server-only";

import { createHash } from "node:crypto";
import { cacheLife } from "next/cache";
import posthogClient from "@/lib/posthog";
import {
	FEATURE_FLAG_KEYS,
	getFallbackFeatureFlags,
	normalizeFeatureFlags,
} from "@/lib/feature-flags";
import { getConfiguredSiteOrigin } from "@/lib/site-url";

const FEATURE_FLAG_CACHE_REVALIDATE_SECONDS = 300;
const FEATURE_FLAG_FETCH_RETRIES = 2;

function getAnonymousFeatureFlagsDistinctId() {
	const deploymentScope =
		getConfiguredSiteOrigin() ||
		process.env.VERCEL_URL ||
		process.env.MEILI_INDEX ||
		"default";

	return `server-flags:${createHash("sha256")
		.update(deploymentScope)
		.digest("hex")
		.slice(0, 32)}`;
}

function getFeatureFlagContext() {
	return {
		distinctId: getAnonymousFeatureFlagsDistinctId(),
		host: process.env.NEXT_PUBLIC_POSTHOG_HOST || null,
		hasKey: Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
		deploymentScope:
			getConfiguredSiteOrigin() ||
			process.env.VERCEL_URL ||
			process.env.MEILI_INDEX ||
			"default",
		flagKeys: [...FEATURE_FLAG_KEYS],
	};
}

function getErrorDetails(error: unknown) {
	if (error instanceof Error) {
		const details: Record<string, unknown> = {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};

		if ("cause" in error && error.cause) {
			details.cause = getErrorDetails(error.cause);
		}

		return details;
	}

	if (typeof error === "object" && error !== null) {
		return error;
	}

	return { value: error };
}

async function sleep(ms: number) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchServerFeatureFlagsFromPostHog() {
	const context = getFeatureFlagContext();
	const result = await posthogClient.getAllFlagsAndPayloads(context.distinctId, {
		disableGeoip: true,
		flagKeys: context.flagKeys,
	});

	return normalizeFeatureFlags(result.featureFlags);
}

async function getCachedServerFeatureFlags() {
	"use cache";
	cacheLife({ revalidate: FEATURE_FLAG_CACHE_REVALIDATE_SECONDS });
	return fetchServerFeatureFlagsFromPostHog();
}

export async function getServerFeatureFlags() {
	if (
		!process.env.NEXT_PUBLIC_POSTHOG_KEY ||
		!process.env.NEXT_PUBLIC_POSTHOG_HOST
	) {
		return getFallbackFeatureFlags();
	}

	try {
		return await getCachedServerFeatureFlags();
	} catch (error) {
		const context = getFeatureFlagContext();
		console.error("Failed to fetch cached PostHog feature flags:", {
			...context,
			error: getErrorDetails(error),
		});
	}

	for (let attempt = 1; attempt <= FEATURE_FLAG_FETCH_RETRIES; attempt++) {
		try {
			return await fetchServerFeatureFlagsFromPostHog();
		} catch (error) {
			console.error("Failed to fetch uncached PostHog feature flags:", {
				...getFeatureFlagContext(),
				attempt,
				error: getErrorDetails(error),
			});

			if (attempt < FEATURE_FLAG_FETCH_RETRIES) {
				await sleep(100 * 2 ** (attempt - 1));
			}
		}
	}

	return getFallbackFeatureFlags();
}
