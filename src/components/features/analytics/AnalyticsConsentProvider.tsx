"use client";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import {
	ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS,
	ANALYTICS_CONSENT_COOKIE_NAME,
	DEFAULT_ANALYTICS_CONSENT_PREFERENCES,
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
	useSyncExternalStore,
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

/**
 * The decision is kept in a cookie, which nothing tells us about when it
 * changes, so anything reading it is told by hand after it is written.
 */
const consentReaders = new Set<() => void>();

function subscribeToConsentCookie(onChange: () => void) {
	consentReaders.add(onChange);

	return () => {
		consentReaders.delete(onChange);
	};
}

function consentCookieValue() {
	if (typeof document === "undefined") return null;

	return (
		document.cookie
			.split("; ")
			.find((entry) =>
				entry.startsWith(`${ANALYTICS_CONSENT_COOKIE_NAME}=`),
			) ?? null
	);
}

/** The server cannot see the browser's cookies, so it starts undecided. */
const noConsentCookie = () => null;

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
	// The decision is read as the page is drawn, so a reader who has already
	// answered is never asked again, and one who has not is asked in the same
	// breath as the page appearing rather than a moment after it.
	const storedConsent = useSyncExternalStore(
		subscribeToConsentCookie,
		consentCookieValue,
		noConsentCookie,
	);
	const record = useMemo(
		() => (storedConsent === null ? null : readConsentCookie(policy)),
		[policy, storedConsent],
	);
	const consentState = analyticsConsentState(record);
	const preferences =
		record?.preferences ?? DEFAULT_ANALYTICS_CONSENT_PREFERENCES;
	const [analyticsReady, setAnalyticsReady] = useState(false);
	const [openedByReader, setOpenedByReader] = useState(false);
	// An undecided reader is always asked, whatever they closed before. That
	// includes a reader whose old answer no longer covers what we do, because
	// the policy has moved on since they gave it.
	const isPreferencesOpen = consentState === "pending" || openedByReader;

	useEffect(() => {
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
	}, [config.analytics, consentState, policy.scope, preferences]);

	const closePreferences = useCallback(() => {
		if (consentState === "pending") return;
		setOpenedByReader(false);
	}, [consentState]);

	const openPreferences = useCallback(() => setOpenedByReader(true), []);

	const savePreferences = useCallback(
		(nextPreferences: AnalyticsConsentPreferences) => {
			const normalized = {
				analytics: nextPreferences.analytics,
				sessionReplay:
					nextPreferences.analytics && nextPreferences.sessionReplay,
			};
			writeConsentCookie(policy, normalized);
			for (const onChange of consentReaders) onChange();
			setOpenedByReader(false);
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
