export type AnalyticsConsentState = "pending" | "granted" | "denied";

export const ANALYTICS_CONSENT_COOKIE_NAME = "analytics_consent";
export const ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS =
	60 * 60 * 24 * 180;
export const DEFAULT_ANALYTICS_CONSENT_STATE: AnalyticsConsentState =
	"pending";

export function parseAnalyticsConsentState(
	value: string | null | undefined
): AnalyticsConsentState {
	if (value === "granted" || value === "denied") {
		return value;
	}

	return DEFAULT_ANALYTICS_CONSENT_STATE;
}

export function serializeAnalyticsConsentState(
	value: AnalyticsConsentState
): string {
	return value;
}
