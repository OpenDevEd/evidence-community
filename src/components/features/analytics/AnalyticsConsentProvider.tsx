"use client";

import {
	ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS,
	ANALYTICS_CONSENT_COOKIE_NAME,
	DEFAULT_ANALYTICS_CONSENT_PREFERENCES,
	analyticsConsentState,
	createAnalyticsConsentRecord,
	parseAnalyticsConsentRecord,
	serializeAnalyticsConsentRecord,
	type AnalyticsConsentPreferences,
	type AnalyticsConsentRecord,
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
	consentPreferences: AnalyticsConsentPreferences;
	consentState: AnalyticsConsentState;
	isPreferencesOpen: boolean;
	openPreferences: () => void;
	setConsentPreferences: (
		preferences: AnalyticsConsentPreferences,
	) => void;
	setConsentState: (nextState: AnalyticsConsentState) => void;
};

const AnalyticsConsentContext =
	createContext<AnalyticsConsentContextValue | null>(null);

function writeConsentCookie(record: AnalyticsConsentRecord) {
	const secureCookie =
		window.location.protocol === "https:" ? "; Secure" : "";
	document.cookie = `${ANALYTICS_CONSENT_COOKIE_NAME}=${serializeAnalyticsConsentRecord(record)}; Max-Age=${ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secureCookie}`;
}

function readConsentCookie() {
	if (typeof document === "undefined") return null;

	const cookieValue = document.cookie
		.split("; ")
		.find((entry) =>
			entry.startsWith(`${ANALYTICS_CONSENT_COOKIE_NAME}=`),
		)
		?.split("=")
		.slice(1)
		.join("=");

	return parseAnalyticsConsentRecord(cookieValue);
}

export function AnalyticsConsentProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const [consentRecord, setConsentRecord] =
		useState<AnalyticsConsentRecord | null>(null);
	const [analyticsReady, setAnalyticsReady] = useState(false);
	const [hasHydratedConsent, setHasHydratedConsent] = useState(false);
	const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
	const consentState = analyticsConsentState(consentRecord);
	const consentPreferences =
		consentRecord?.preferences ?? DEFAULT_ANALYTICS_CONSENT_PREFERENCES;

	useEffect(() => {
		let cancelled = false;
		const record = readConsentCookie();
		const state = analyticsConsentState(record);
		const preferences =
			record?.preferences ?? DEFAULT_ANALYTICS_CONSENT_PREFERENCES;
		applyClientAnalyticsConsent(state, preferences);
		queueMicrotask(() => {
			if (cancelled) return;
			setConsentRecord(record);
			setAnalyticsReady(state === "granted");
			setIsPreferencesOpen(record === null);
			setHasHydratedConsent(true);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const closePreferences = useCallback(() => {
		if (!hasHydratedConsent || !consentRecord) return;
		setIsPreferencesOpen(false);
	}, [consentRecord, hasHydratedConsent]);

	const openPreferences = useCallback(() => {
		setIsPreferencesOpen(true);
	}, []);

	const setConsentPreferences = useCallback(
		(preferences: AnalyticsConsentPreferences) => {
			const record = createAnalyticsConsentRecord(preferences);
			writeConsentCookie(record);
			applyClientAnalyticsConsent(
				analyticsConsentState(record),
				record.preferences,
			);
			setConsentRecord(record);
			setAnalyticsReady(record.preferences.analytics);
			setIsPreferencesOpen(false);
		},
		[],
	);

	const setConsentState = useCallback(
		(nextState: AnalyticsConsentState) => {
			if (nextState === "pending") return;
			setConsentPreferences({
				analytics: nextState === "granted",
				sessionReplay: nextState === "granted",
			});
		},
		[setConsentPreferences],
	);

	const value = useMemo(
		() => ({
			analyticsReady,
			closePreferences,
			consentPreferences,
			consentState,
			isPreferencesOpen,
			openPreferences,
			setConsentPreferences,
			setConsentState,
		}),
		[
			analyticsReady,
			closePreferences,
			consentPreferences,
			consentState,
			isPreferencesOpen,
			openPreferences,
			setConsentPreferences,
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
