export type AnalyticsConsentState = "pending" | "granted" | "denied";

export type AnalyticsConsentPreferences = {
	analytics: boolean;
	sessionReplay: boolean;
};

export const ANALYTICS_CONSENT_COOKIE_NAME = "analytics_consent";
export const ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
export const ANALYTICS_CONSENT_POLICY_VERSION = 1 as const;

export type AnalyticsConsentRecord = {
	version: typeof ANALYTICS_CONSENT_POLICY_VERSION;
	decidedAt: number;
	preferences: AnalyticsConsentPreferences;
};

export const DEFAULT_ANALYTICS_CONSENT_STATE: AnalyticsConsentState =
	"pending";
export const DEFAULT_ANALYTICS_CONSENT_PREFERENCES = {
	analytics: false,
	sessionReplay: false,
} satisfies AnalyticsConsentPreferences;

function isConsentRecord(value: unknown): value is AnalyticsConsentRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	const version = Reflect.get(value, "version");
	const decidedAt = Reflect.get(value, "decidedAt");
	const preferences = Reflect.get(value, "preferences");

	if (
		version !== ANALYTICS_CONSENT_POLICY_VERSION ||
		typeof decidedAt !== "number" ||
		!Number.isFinite(decidedAt) ||
		decidedAt <= 0 ||
		!preferences ||
		typeof preferences !== "object" ||
		Array.isArray(preferences)
	) {
		return false;
	}

	const analytics = Reflect.get(preferences, "analytics");
	const sessionReplay = Reflect.get(preferences, "sessionReplay");

	return (
		typeof analytics === "boolean" &&
		typeof sessionReplay === "boolean" &&
		(!sessionReplay || analytics)
	);
}

export function createAnalyticsConsentRecord(
	preferences: AnalyticsConsentPreferences,
	now = Date.now(),
): AnalyticsConsentRecord {
	return {
		version: ANALYTICS_CONSENT_POLICY_VERSION,
		decidedAt: now,
		preferences: {
			analytics: preferences.analytics,
			sessionReplay:
				preferences.analytics && preferences.sessionReplay,
		},
	};
}

export function analyticsConsentState(
	record: AnalyticsConsentRecord | null,
): AnalyticsConsentState {
	if (!record) return DEFAULT_ANALYTICS_CONSENT_STATE;
	return record.preferences.analytics ? "granted" : "denied";
}

export function parseAnalyticsConsentRecord(
	value: string | null | undefined,
): AnalyticsConsentRecord | null {
	if (!value) return null;

	try {
		const parsed = JSON.parse(decodeURIComponent(value));
		return isConsentRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function serializeAnalyticsConsentRecord(
	record: AnalyticsConsentRecord,
): string {
	return encodeURIComponent(JSON.stringify(record));
}

export function readAnalyticsConsentCookieHeader(
	cookieHeader: string | null | undefined,
): AnalyticsConsentRecord | null {
	if (!cookieHeader) return null;

	const value = cookieHeader
		.split(";")
		.map((entry) => entry.trim())
		.find((entry) =>
			entry.startsWith(`${ANALYTICS_CONSENT_COOKIE_NAME}=`),
		)
		?.split("=")
		.slice(1)
		.join("=");

	return parseAnalyticsConsentRecord(value);
}
