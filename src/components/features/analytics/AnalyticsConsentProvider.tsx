"use client";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import {
	ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS,
	ANALYTICS_CONSENT_COOKIE_NAME,
	DEFAULT_ANALYTICS_CONSENT_PREFERENCES,
	analyticsConsentState,
	analyticsCapabilities,
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
	capabilities: AnalyticsConsentPreferences;
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
	capabilities: AnalyticsConsentPreferences,
) {
	const secureCookie =
		typeof window !== "undefined" && window.location.protocol === "https:"
			? "; Secure"
			: "";
	const value = serializeAnalyticsConsentRecord(
		createAnalyticsConsentRecord(policy, {
			analytics: capabilities.analytics && preferences.analytics,
			sessionReplay: capabilities.sessionReplay && preferences.sessionReplay,
		}),
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

/** The stored answer as the browser has it, or null when there is none. */
function consentCookieValue() {
	if (typeof document === "undefined") return null;
	const prefix = `${ANALYTICS_CONSENT_COOKIE_NAME}=`;
	const entry = document.cookie
		.split("; ")
		.find((cookie) => cookie.startsWith(prefix));

	return entry === undefined ? null : entry.slice(prefix.length);
}

export function AnalyticsConsentProvider({
	children,
	storedConsentFromServer = null,
}: {
	children: React.ReactNode;
	/**
	 * The stored answer as the server read it. Passing it means the very
	 * first drawing of the page already knows whether the reader has
	 * answered, so a returning reader is never interrupted and a new one is
	 * asked from the start rather than a moment later.
	 */
	storedConsentFromServer?: string | null;
}) {
	const config = useLibraryConfig();
	const { capabilities, policy } = useMemo(
		() => ({
			capabilities: analyticsCapabilities(config.analytics),
			policy: {
				scope: normalizeAnalyticsConsentScope(config.identity.baseUrl),
				version: config.analytics.consentPolicyVersion,
			},
		}),
		[config.analytics, config.identity.baseUrl],
	);
	// The decision is read as the page is drawn, so a reader who has already
	// answered is never asked again, and one who has not is asked in the same
	// breath as the page appearing rather than a moment after it.
	const storedConsent = useSyncExternalStore(
		subscribeToConsentCookie,
		consentCookieValue,
		() => storedConsentFromServer,
	);
	const record = useMemo(
		() => parseAnalyticsConsentRecord(storedConsent, policy),
		[policy, storedConsent],
	);
	const consentState = analyticsConsentState(record);
	const preferences =
		record?.preferences ?? DEFAULT_ANALYTICS_CONSENT_PREFERENCES;
	const [analyticsReady, setAnalyticsReady] = useState(false);
	const [openedByReader, setOpenedByReader] = useState(false);
	// Ask only about configured analytics, including when an earlier answer
	// no longer covers the current policy.
	const isPreferencesOpen =
		capabilities.analytics && (consentState === "pending" || openedByReader);

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

	const closePreferences = useCallback(() => setOpenedByReader(false), []);

	const openPreferences = useCallback(() => setOpenedByReader(true), []);

	const savePreferences = useCallback(
		(nextPreferences: AnalyticsConsentPreferences) => {
			writeConsentCookie(policy, nextPreferences, capabilities);
			for (const onChange of consentReaders) onChange();
			setOpenedByReader(false);
		},
		[capabilities, policy],
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
			capabilities,
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
			capabilities,
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
