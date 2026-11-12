"use client";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import {
	DEFAULT_ANALYTICS_CONSENT_PREFERENCES,
	analyticsConsentCookie,
	analyticsConsentCookieName,
	analyticsConsentPolicy,
	analyticsConsentState,
	analyticsCapabilities,
	parseAnalyticsConsentRecord,
	sharesAnalyticsConsent,
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
	/** The answer is Openscholar's, shared with every community on openscholar.ai, and one yes covers replay too. */
	sharesAnswer: boolean;
};

const AnalyticsConsentContext =
	createContext<AnalyticsConsentContextValue | null>(null);

function writeConsentCookie(
	policy: AnalyticsConsentPolicy,
	preferences: AnalyticsConsentPreferences,
	capabilities: AnalyticsConsentPreferences,
) {
	document.cookie = analyticsConsentCookie(
		policy,
		{
			analytics: capabilities.analytics && preferences.analytics,
			sessionReplay: capabilities.sessionReplay && preferences.sessionReplay,
		},
		{ secure: window.location.protocol === "https:" },
	);
}

/**
 * The decision is kept in a cookie, which nothing reports a change to on its own: an answer given here tells the
 * readers by hand, and one given in another tab (on Openscholar or another community, for a shared answer) is read
 * again when this tab comes back into view or focus, or as soon as the browser reports the cookie changed.
 */
const consentReaders = new Set<() => void>();

type CookieStoreWindow = Window & { cookieStore?: EventTarget };

function subscribeToConsentCookie(onChange: () => void) {
	consentReaders.add(onChange);
	const cookieStore = (window as CookieStoreWindow).cookieStore;
	window.addEventListener("focus", onChange);
	document.addEventListener("visibilitychange", onChange);
	cookieStore?.addEventListener("change", onChange);

	return () => {
		consentReaders.delete(onChange);
		window.removeEventListener("focus", onChange);
		document.removeEventListener("visibilitychange", onChange);
		cookieStore?.removeEventListener("change", onChange);
	};
}

/** The stored answer as the browser has it, or null when there is none. */
function consentCookieValue(name: string) {
	if (typeof document === "undefined") return null;
	const prefix = `${name}=`;
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
			policy: analyticsConsentPolicy({ analytics: config.analytics, identity: { baseUrl: config.identity.baseUrl } }),
		}),
		[config.analytics, config.identity.baseUrl],
	);
	const sharesAnswer = sharesAnalyticsConsent(policy);
	const cookieName = analyticsConsentCookieName(policy);
	// The decision is read as the page is drawn, so a reader who has already
	// answered is never asked again, and one who has not is asked in the same
	// breath as the page appearing rather than a moment after it.
	const storedConsent = useSyncExternalStore(
		subscribeToConsentCookie,
		() => consentCookieValue(cookieName),
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
			sharesAnswer,
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
			sharesAnswer,
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
