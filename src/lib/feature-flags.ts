export const FEATURE_FLAG_KEYS = [
	"ai-features",
	"ai-search",
	"atom-feed",
	"author-filter",
	"author-location",
	"collection-note",
	"collections",
	"country-focus",
	"deep-research",
	"download-button",
	"language-switcher",
	"login",
	"new-resource-page",
	"related-resources",
	"theme-switcher",
	"user-collections",
	"years-dropdown",
] as const;

export const FALLBACK_ENABLED_FEATURE_FLAGS = [
	"language-switcher",
	"theme-switcher",
	"login",
	"collections",
	"download-button",
	"user-collections",
] as const;

export function getFallbackFeatureFlags(): string[] {
	return [...FALLBACK_ENABLED_FEATURE_FLAGS];
}

export function normalizeFeatureFlags(
	flags: Record<string, unknown> | null | undefined
): string[] {
	if (!flags) {
		return getFallbackFeatureFlags();
	}

	return FEATURE_FLAG_KEYS.filter((flag) => Boolean(flags[flag]));
}
