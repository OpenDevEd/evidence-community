export type AnalyticsConsentState = "pending" | "granted" | "denied";

export type AnalyticsConsentPreferences = {
	analytics: boolean;
	sessionReplay: boolean;
};

export type AnalyticsConsentPolicy = {
	scope: string;
	version: number;
};

export type AnalyticsConsentRecord = AnalyticsConsentPolicy & {
	decidedAt: number;
	preferences: AnalyticsConsentPreferences;
};

export const ANALYTICS_CONSENT_COOKIE_NAME = "analytics_consent";
export const ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
export const DEFAULT_ANALYTICS_CONSENT_STATE: AnalyticsConsentState = "pending";
export const DEFAULT_ANALYTICS_CONSENT_PREFERENCES = {
	analytics: false,
	sessionReplay: false,
} satisfies AnalyticsConsentPreferences;

function isPolicy(value: AnalyticsConsentPolicy) {
	return value.scope.length > 0 && Number.isInteger(value.version) && value.version > 0;
}

function isConsentRecord(
	value: unknown,
	policy: AnalyticsConsentPolicy,
	now: number,
): value is AnalyticsConsentRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;

	const scope = Reflect.get(value, "scope");
	const version = Reflect.get(value, "version");
	const decidedAt = Reflect.get(value, "decidedAt");
	const preferences = Reflect.get(value, "preferences");

	if (
		scope !== policy.scope ||
		version !== policy.version ||
		typeof decidedAt !== "number" ||
		!Number.isFinite(decidedAt) ||
		decidedAt <= 0 ||
		decidedAt > now ||
		now - decidedAt > ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS * 1_000 ||
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

export function normalizeAnalyticsConsentScope(baseUrl: string) {
	return new URL(baseUrl).origin;
}

export function createAnalyticsConsentRecord(
	policy: AnalyticsConsentPolicy,
	preferences: AnalyticsConsentPreferences,
	now = Date.now(),
): AnalyticsConsentRecord {
	if (!isPolicy(policy)) {
		throw new Error("Analytics consent policy needs a scope and positive version");
	}

	return {
		scope: normalizeAnalyticsConsentScope(policy.scope),
		version: policy.version,
		decidedAt: now,
		preferences: {
			analytics: preferences.analytics,
			sessionReplay: preferences.analytics && preferences.sessionReplay,
		},
	};
}

export function analyticsConsentState(record: AnalyticsConsentRecord | null): AnalyticsConsentState {
	if (!record) return DEFAULT_ANALYTICS_CONSENT_STATE;
	return record.preferences.analytics ? "granted" : "denied";
}

export function parseAnalyticsConsentRecord(
	value: string | null | undefined,
	policy: AnalyticsConsentPolicy,
	now = Date.now(),
): AnalyticsConsentRecord | null {
	if (!value || !isPolicy(policy)) return null;

	const normalizedPolicy = {
		...policy,
		scope: normalizeAnalyticsConsentScope(policy.scope),
	};

	try {
		const parsed = JSON.parse(decodeURIComponent(value));
		return isConsentRecord(parsed, normalizedPolicy, now) ? parsed : null;
	} catch {
		return null;
	}
}

export function serializeAnalyticsConsentRecord(record: AnalyticsConsentRecord): string {
	return encodeURIComponent(JSON.stringify(record));
}

export function readAnalyticsConsentCookieHeader(
	cookieHeader: string | null | undefined,
	policy: AnalyticsConsentPolicy,
	now = Date.now(),
): AnalyticsConsentRecord | null {
	if (!cookieHeader) return null;

	const value = cookieHeader
		.split(";")
		.map((entry) => entry.trim())
		.find((entry) => entry.startsWith(`${ANALYTICS_CONSENT_COOKIE_NAME}=`))
		?.split("=")
		.slice(1)
		.join("=");

	return parseAnalyticsConsentRecord(value, policy, now);
}
