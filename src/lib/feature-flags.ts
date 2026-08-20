export type RuntimeFeatureFlagValue = boolean | string;

export type RuntimeFeatureFlags = Record<string, RuntimeFeatureFlagValue>;

export const EMPTY_FEATURE_FLAGS: RuntimeFeatureFlags = {};

const DEVELOPMENT_ENABLED_FEATURE_FLAGS = new Set([
	"ai-features",
	"ai-search",
	"deep-research",
]);

export function isFeatureFlagEnabled(
	featureFlags: RuntimeFeatureFlags | null | undefined,
	flag: string
) {
	// AI flags are always on in development; every built tenant is governed
	// by its PostHog flags alone.
	if (
		process.env.NODE_ENV === "development" &&
		DEVELOPMENT_ENABLED_FEATURE_FLAGS.has(flag)
	) {
		return true;
	}

	return Boolean(featureFlags?.[flag]);
}
