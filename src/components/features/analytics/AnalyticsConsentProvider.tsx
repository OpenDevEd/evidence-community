"use client";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import {
	ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS,
	ANALYTICS_CONSENT_COOKIE_NAME,
	DEFAULT_ANALYTICS_CONSENT_PREFERENCES,
	DEFAULT_ANALYTICS_CONSENT_STATE,
	analyticsConsentState,
	createAnalyticsConsentRecord,
	normalizeAnalyticsConsentScope,
	parseAnalyticsConsentRecord,
	serializeAnalyticsConsentRecord,
	type AnalyticsConsentPreferences,
	type AnalyticsConsentPolicy,
	type AnalyticsConsentState,
} from "@/lib/analytics-consent";
import { applyClientAnalyticsConsent } from "@/lib/analytics";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

type AnalyticsConsentContextValue = {
	analyticsReady: boolean;
	closePreferences: () => void;
	consentState: AnalyticsConsentState;
	preferences: AnalyticsConsentPreferences;
	isPreferencesOpen: boolean;
	openPreferences: () => void;
	savePreferences: (preferences: AnalyticsConsentPreferences) => void;
	setConsentState: (nextState: AnalyticsConsentState) => void;
};

const AnalyticsConsentContext =
	createContext<AnalyticsConsentContextValue | null>(null);

function writeConsentCookie(
	policy: AnalyticsConsentPolicy,
	preferences: AnalyticsConsentPreferences,
) {
	const secureCookie =
		typeof window !== "undefined" && window.location.protocol === "https:"
			? "; Secure"
			: "";
	const value = serializeAnalyticsConsentRecord(
		createAnalyticsConsentRecord(policy, preferences),
	);
	document.cookie = `${ANALYTICS_CONSENT_COOKIE_NAME}=${value}; Max-Age=${ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secureCookie}`;
}

function readConsentCookie(policy: AnalyticsConsentPolicy) {
	if (typeof document === "undefined") return null;
	const cookieValue = document.cookie
		.split("; ")
		.find((entry) => entry.startsWith(`${ANALYTICS_CONSENT_COOKIE_NAME}=`))
		?.split("=")
		.slice(1)
		.join("=");
	return parseAnalyticsConsentRecord(cookieValue, policy);
}

export function AnalyticsConsentProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const config = useLibraryConfig();
	const policy = useMemo(
		() => ({
			scope: normalizeAnalyticsConsentScope(config.identity.baseUrl),
			version: config.analytics.consentPolicyVersion,
		}),
		[config.analytics.consentPolicyVersion, config.identity.baseUrl],
	);
	const [consentState, setConsentStateValue] =
		useState<AnalyticsConsentState>(DEFAULT_ANALYTICS_CONSENT_STATE);
	const [preferences, setPreferences] = useState<AnalyticsConsentPreferences>(
		DEFAULT_ANALYTICS_CONSENT_PREFERENCES,
	);
	const [analyticsReady, setAnalyticsReady] = useState(false);
	const [hasHydratedConsent, setHasHydratedConsent] = useState(false);
	const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);

	useEffect(() => {
		const hydrationTimer = window.setTimeout(() => {
			const record = readConsentCookie(policy);
			const nextState = analyticsConsentState(record);
			setConsentStateValue(nextState);
			setPreferences(
				record?.preferences ?? DEFAULT_ANALYTICS_CONSENT_PREFERENCES,
			);
			setIsPreferencesOpen(nextState === "pending");
			setHasHydratedConsent(true);
		}, 0);
		return () => window.clearTimeout(hydrationTimer);
	}, [policy]);

	useEffect(() => {
		if (!hasHydratedConsent) return;
		let active = true;
		void applyClientAnalyticsConsent(
			{ analytics: config.analytics, scope: policy.scope },
			consentState,
			preferences,
		).then((ready) => {
			if (active) setAnalyticsReady(ready);
		});
		return () => {
			active = false;
		};
	}, [
		config.analytics,
		consentState,
		hasHydratedConsent,
		policy.scope,
		preferences,
	]);

	const closePreferences = useCallback(() => {
		if (!hasHydratedConsent || consentState === "pending") return;
		setIsPreferencesOpen(false);
	}, [consentState, hasHydratedConsent]);

	const openPreferences = useCallback(() => setIsPreferencesOpen(true), []);

	const savePreferences = useCallback(
		(nextPreferences: AnalyticsConsentPreferences) => {
			const normalized = {
				analytics: nextPreferences.analytics,
				sessionReplay:
					nextPreferences.analytics && nextPreferences.sessionReplay,
			};
			writeConsentCookie(policy, normalized);
			setPreferences(normalized);
			setConsentStateValue(normalized.analytics ? "granted" : "denied");
			setIsPreferencesOpen(false);
		},
		[policy],
	);

	const setConsentState = useCallback(
		(nextState: AnalyticsConsentState) => {
			if (nextState === "pending") return;
			savePreferences({
				analytics: nextState === "granted",
				sessionReplay: nextState === "granted",
			});
		},
		[savePreferences],
	);

	const value = useMemo(
		() => ({
			analyticsReady,
			closePreferences,
			consentState,
			preferences,
			isPreferencesOpen,
			openPreferences,
			savePreferences,
			setConsentState,
		}),
		[
			analyticsReady,
			closePreferences,
			consentState,
			preferences,
			isPreferencesOpen,
			openPreferences,
			savePreferences,
			setConsentState,
		],
	);

	return (
		<AnalyticsConsentContext.Provider value={value}>
			{children}
		</AnalyticsConsentContext.Provider>
	);
}

export function useAnalyticsConsent() {
	const value = useContext(AnalyticsConsentContext);
	if (!value) {
		throw new Error(
			"useAnalyticsConsent must be used within AnalyticsConsentProvider",
		);
	}
	return value;
}
