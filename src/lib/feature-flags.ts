export type RuntimeFeatureFlagValue = boolean | string;

export type RuntimeFeatureFlags = Record<string, RuntimeFeatureFlagValue>;

export const EMPTY_FEATURE_FLAGS: RuntimeFeatureFlags = {};

export function isFeatureFlagEnabled(
	featureFlags: RuntimeFeatureFlags | null | undefined,
	flag: string
) {
	return Boolean(featureFlags?.[flag]);
}
