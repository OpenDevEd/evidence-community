export const FEATURE_FLAGS_COOKIE_NAME = "feature_flags";
export const FEATURE_FLAGS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

export function parseFeatureFlagsCookieValue(
	rawValue: string | null | undefined
): string[] | null {
	if (!rawValue) return null;

	try {
		const decoded = decodeURIComponent(rawValue);
		const parsed = JSON.parse(decoded);
		if (!Array.isArray(parsed)) return null;
		return parsed.filter((flag): flag is string => typeof flag === "string");
	} catch {
		return null;
	}
}

export function serializeFeatureFlagsCookieValue(
	featureFlags: Iterable<string>
): string {
	const uniqueSortedFlags = Array.from(new Set(featureFlags)).sort();
	return encodeURIComponent(JSON.stringify(uniqueSortedFlags));
}
