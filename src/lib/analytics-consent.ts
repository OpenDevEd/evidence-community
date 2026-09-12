import type { LibraryPublicConfig } from "@/config/library-config/schema";
import { isPolicyPage } from "@/lib/legal-links";
import { isAdminPath } from "@/lib/path";

export type AnalyticsConsentState = "pending" | "granted" | "denied";

export type AnalyticsConsentPreferences = {
	analytics: boolean;
	sessionReplay: boolean;
};

export function analyticsCapabilities(analytics: LibraryPublicConfig["analytics"]): AnalyticsConsentPreferences {
	const posthog = Boolean(analytics.posthog.host && analytics.posthog.key);
	return {
		analytics: posthog || Boolean(analytics.google.measurementId),
		sessionReplay: posthog,
	};
}

export type AnalyticsConsentPolicy = {
	scope: string;
	version: number;
};

export type AnalyticsConsentRecord = AnalyticsConsentPolicy & {
	runtimePolicyVersion: number;
	decidedAt: number;
	preferences: AnalyticsConsentPreferences;
};

// Bump when the built-in notice or collection policy changes. Library owners
// version their own notice separately through consentPolicyVersion.
const RUNTIME_ANALYTICS_POLICY_VERSION = 2;

export const ANALYTICS_CONSENT_COOKIE_NAME = "analytics_consent";
export const ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
/** Nobody has answered yet. */
const DEFAULT_ANALYTICS_CONSENT_STATE: AnalyticsConsentState = "pending";
export const DEFAULT_ANALYTICS_CONSENT_PREFERENCES = {
	analytics: false,
	sessionReplay: false,
} satisfies AnalyticsConsentPreferences;

function isPolicy(value: AnalyticsConsentPolicy) {
	return (
		value.scope.length > 0 &&
		Number.isInteger(value.version) &&
		value.version > 0
	);
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasMatchingPolicy(
	value: Record<string, unknown>,
	policy: AnalyticsConsentPolicy,
) {
	return value.scope === policy.scope && value.version === policy.version &&
		value.runtimePolicyVersion === RUNTIME_ANALYTICS_POLICY_VERSION;
}

function hasValidDecisionTime(value: unknown, now: number) {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value > 0 &&
		value <= now &&
		now - value <= ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS * 1_000
	);
}

function hasValidPreferences(value: unknown) {
	if (!isRecordObject(value)) return false;
	const analytics = value.analytics;
	const sessionReplay = value.sessionReplay;
	return (
		typeof analytics === "boolean" &&
		typeof sessionReplay === "boolean" &&
		(!sessionReplay || analytics)
	);
}

function isConsentRecord(
	value: unknown,
	policy: AnalyticsConsentPolicy,
	now: number,
): value is AnalyticsConsentRecord {
	return (
		isRecordObject(value) &&
		hasMatchingPolicy(value, policy) &&
		hasValidDecisionTime(value.decidedAt, now) &&
		hasValidPreferences(value.preferences)
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
		throw new Error(
			"Analytics consent policy needs a scope and positive version",
		);
	}

	return {
		scope: normalizeAnalyticsConsentScope(policy.scope),
		version: policy.version,
		runtimePolicyVersion: RUNTIME_ANALYTICS_POLICY_VERSION,
		decidedAt: now,
		preferences: {
			analytics: preferences.analytics,
			sessionReplay: preferences.analytics && preferences.sessionReplay,
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

export function serializeAnalyticsConsentRecord(
	record: AnalyticsConsentRecord,
): string {
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

/**
 * Whether the cookie question is asked on this page.
 *
 * The admin area has no dialog, and the pages that explain the cookies must
 * stay readable while the question is open, so neither is ever asked and
 * neither is ever held still.
 */
export function asksAnalyticsConsent(pathname: string, locale: string, config: Parameters<typeof isPolicyPage>[1]) {
	return !isAdminPath(pathname, locale) && !isPolicyPage(pathname, config);
}
