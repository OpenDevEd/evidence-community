"use client";

import {
	DEFAULT_ANALYTICS_CONSENT_STATE,
	ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS,
	ANALYTICS_CONSENT_COOKIE_NAME,
	parseAnalyticsConsentState,
	type AnalyticsConsentState,
} from "@/lib/analytics-consent";
import {
	clearAnalyticsStorage,
	initializeClientAnalytics,
	initializePostHog,
	updateGoogleConsent,
} from "@/lib/analytics";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

type AnalyticsConsentContextValue = {
	analyticsReady: boolean;
	closePreferences: () => void;
	consentState: AnalyticsConsentState;
	isPreferencesOpen: boolean;
	openPreferences: () => void;
	setConsentState: (nextState: AnalyticsConsentState) => void;
};

const AnalyticsConsentContext =
	createContext<AnalyticsConsentContextValue | null>(null);

function writeConsentCookie(nextState: AnalyticsConsentState) {
	const secureCookie =
		typeof window !== "undefined" && window.location.protocol === "https:"
			? "; Secure"
			: "";

	document.cookie = `${ANALYTICS_CONSENT_COOKIE_NAME}=${nextState}; Max-Age=${ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secureCookie}`;
}

function readConsentCookie() {
	if (typeof document === "undefined") {
		return DEFAULT_ANALYTICS_CONSENT_STATE;
	}

	const cookieValue = document.cookie
		.split("; ")
		.find((entry) => entry.startsWith(`${ANALYTICS_CONSENT_COOKIE_NAME}=`))
		?.split("=")
		.slice(1)
		.join("=");

	return parseAnalyticsConsentState(cookieValue);
}

export function AnalyticsConsentProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const { analytics } = useLibraryConfig();
	const [consentState, setConsentStateValue] = useState<AnalyticsConsentState>(
		DEFAULT_ANALYTICS_CONSENT_STATE
	);
	const [analyticsReady, setAnalyticsReady] = useState(false);
	const [hasHydratedConsent, setHasHydratedConsent] = useState(false);
	const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);

	useEffect(() => {
		initializePostHog(analytics.posthog);
	}, [analytics.posthog]);

	useEffect(() => {
		const nextConsentState = readConsentCookie();
		setConsentStateValue(nextConsentState);
		setIsPreferencesOpen(nextConsentState === "pending");
		setHasHydratedConsent(true);
	}, []);

	useEffect(() => {
		if (!hasHydratedConsent) {
			return;
		}

		if (consentState !== "granted") {
			setAnalyticsReady(false);
			updateGoogleConsent(false);
			return;
		}

		const didInitialize = initializeClientAnalytics(analytics);
		updateGoogleConsent(true);
		setAnalyticsReady(didInitialize);
	}, [analytics, consentState, hasHydratedConsent]);

	const closePreferences = useCallback(() => {
		if (!hasHydratedConsent || consentState === "pending") {
			return;
		}

		setIsPreferencesOpen(false);
	}, [consentState, hasHydratedConsent]);

	const openPreferences = useCallback(() => {
		setIsPreferencesOpen(true);
	}, []);

	const setConsentState = useCallback(
		(nextState: AnalyticsConsentState) => {
			if (nextState === "pending") {
				return;
			}

			writeConsentCookie(nextState);
			setConsentStateValue(nextState);
			setIsPreferencesOpen(false);

			if (nextState === "denied") {
				clearAnalyticsStorage();
			}
		},
		[]
	);

	const value = useMemo(
		() => ({
			analyticsReady,
			closePreferences,
			consentState,
			isPreferencesOpen,
			openPreferences,
			setConsentState,
		}),
		[
			analyticsReady,
			closePreferences,
			consentState,
			isPreferencesOpen,
			openPreferences,
			setConsentState,
		]
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
			"useAnalyticsConsent must be used within AnalyticsConsentProvider"
		);
	}

	return value;
}
