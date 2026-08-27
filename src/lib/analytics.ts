"use client";

import type {
	AnalyticsConsentPreferences,
	AnalyticsConsentState,
} from "@/lib/analytics-consent";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "@/lib/analytics-consent";
import { sanitizeAnalyticsPath } from "@/lib/analytics-shared";
import type { CaptureResult } from "posthog-js";

type PostHogBrowserClient = typeof import("posthog-js").default;

declare global {
	interface Window {
		dataLayer?: unknown[];
		gtag?: (...args: unknown[]) => void;
		[key: `ga-disable-${string}`]: boolean | unknown;
	}
}

export type AttachmentAnalyticsAction = "view" | "download" | "open";
export type AttachmentAnalyticsSource = "internal" | "external";

export type AttachmentAnalyticsPayload = {
	action: AttachmentAnalyticsAction;
	source: AttachmentAnalyticsSource;
	parentType?: string | null;
	locale: string;
	isAuthenticated: boolean;
};

export type LibraryResultsAnalyticsPayload = {
	hasSearch: boolean;
	filterCount: number;
	page: number;
	pageResultCount: number;
	totalResultCount: number;
	scope: string;
	sort: string;
};

export type ContentActionAnalyticsPayload = {
	action: "copy" | "download";
	context:
		| "ai_response"
		| "chat_transcript"
		| "generated_content"
		| "library_records"
		| "smart_screening";
	format: string;
};

export type AnalyticsAttribution = Partial<
	Record<
		| "utm_source"
		| "utm_medium"
		| "utm_campaign"
		| "utm_term"
		| "utm_content",
		string
	>
>;

type BrowserAnalyticsMode = AnalyticsConsentState;
type QueuedGoogleEvent = {
	eventName: string;
	params: Record<string, unknown>;
};

const GOOGLE_COOKIE_PREFIXES = ["_ga", "_gid", "_gat"];
const POSTHOG_STORAGE_PREFIXES = ["ph_", "__ph_", "posthog"];
const ATTRIBUTION_STORAGE_KEY = "utm:active";
const SENSITIVE_PROPERTY_NAME =
	/(^|_)(abstract|authorization|body|chat|content|email|file(name|_name)?|link_(text|url)|message|parent_title|password|pdf|prompt|query|response|search_(body|query|term)|text|title|token|transcript|user_id)(_|$)/i;

let analyticsMode: BrowserAnalyticsMode = "pending";
let analyticsPreferences: AnalyticsConsentPreferences = {
	analytics: false,
	sessionReplay: false,
};
let posthogClient: PostHogBrowserClient | null = null;
let posthogInitialized = false;
let posthogInitialization: Promise<boolean> | null = null;
let appliedPostHogConsentSignature: string | null = null;
let googleAnalyticsMeasurementId: string | null = null;
let googleAnalyticsReady = false;
let removeClientErrorListeners: (() => void) | null = null;
const queuedGoogleEvents: QueuedGoogleEvent[] = [];

function analyticsDebug(message: string, details?: Record<string, unknown>) {
	if (process.env.NODE_ENV === "production") return;
	console.debug("[analytics]", message, details ?? {});
}

function getPostHogApiHost() {
	return process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || null;
}

function getPostHogUiHost(apiHost: string) {
	const configured = process.env.NEXT_PUBLIC_POSTHOG_UI_HOST?.trim();
	if (configured) return configured;
	if (apiHost.includes("eu.i.posthog.com")) return "https://eu.posthog.com";
	if (apiHost.includes("us.i.posthog.com")) return "https://us.posthog.com";
	return apiHost;
}

function gtag(...args: unknown[]) {
	if (typeof window === "undefined") return;

	if (typeof window.gtag === "function") {
		window.gtag(...args);
		return;
	}

	window.dataLayer = window.dataLayer || [];
	window.dataLayer.push(args);
}

function getGoogleConsentUpdate(granted: boolean) {
	return {
		ad_storage: "denied",
		ad_user_data: "denied",
		ad_personalization: "denied",
		analytics_storage: granted ? "granted" : "denied",
	};
}

function resetGoogleAnalyticsState() {
	if (
		typeof window !== "undefined" &&
		googleAnalyticsMeasurementId
	) {
		window[`ga-disable-${googleAnalyticsMeasurementId}`] = true;
	}
	googleAnalyticsMeasurementId = null;
	googleAnalyticsReady = false;
	queuedGoogleEvents.length = 0;
}

function sendGoogleEvent(
	eventName: string,
	params: Record<string, unknown>,
) {
	if (analyticsMode !== "granted" || !googleAnalyticsMeasurementId) {
		return;
	}

	if (!googleAnalyticsReady) {
		queuedGoogleEvents.push({ eventName, params });
		return;
	}

	gtag("event", eventName, {
		send_to: googleAnalyticsMeasurementId,
		...params,
	});
}

function flushQueuedGoogleEvents() {
	if (!googleAnalyticsReady || !googleAnalyticsMeasurementId) return;

	while (queuedGoogleEvents.length > 0) {
		const nextEvent = queuedGoogleEvents.shift();
		if (!nextEvent) continue;
		gtag("event", nextEvent.eventName, {
			send_to: googleAnalyticsMeasurementId,
			...nextEvent.params,
		});
	}
}

function sanitizedCurrentUrl(value: unknown) {
	const fallback =
		typeof window === "undefined" ? "https://analytics.local/" : window.location.origin;
	if (typeof value !== "string") return fallback;

	try {
		const url = new URL(value, fallback);
		return `${url.origin}${url.pathname}`;
	} catch {
		return `${fallback}${sanitizeAnalyticsPath(value)}`;
	}
}

function sanitizeString(value: string) {
	return value
		.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
		.replace(/https?:\/\/[^\s]+/gi, (url) => sanitizedCurrentUrl(url));
}

function sanitizePostHogEvent(event: CaptureResult | null) {
	if (!event || analyticsMode !== "granted") return null;

	const properties = Object.fromEntries(
		Object.entries(event.properties).flatMap(([key, value]) => {
			if (key === "$current_url") {
				return [[key, sanitizedCurrentUrl(value)]];
			}
			if (key === "$pathname") {
				return [[key, sanitizeAnalyticsPath(String(value ?? "/"))]];
			}
			if (key === "$referrer" || key === "$initial_referrer") {
				return [];
			}
			if (SENSITIVE_PROPERTY_NAME.test(key)) {
				return [];
			}
			return [[key, typeof value === "string" ? sanitizeString(value) : value]];
		}),
	);

	return { ...event, properties };
}

function clearCookies(prefixes: string[]) {
	if (typeof document === "undefined") return;

	const cookieNames = document.cookie
		.split(";")
		.map((cookie) => cookie.trim().split("=")[0])
		.filter((name) => prefixes.some((prefix) => name.startsWith(prefix)));

	for (const cookieName of cookieNames) {
		const base = `${cookieName}=; Max-Age=0; Path=/; SameSite=Lax; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
		document.cookie = base;
		document.cookie = `${base}; Domain=${window.location.hostname}`;
		document.cookie = `${base}; Domain=.${window.location.hostname}`;
		const parts = window.location.hostname.split(".");
		if (parts.length > 2) {
			document.cookie = `${base}; Domain=.${parts.slice(1).join(".")}`;
		}
	}
}

function clearPostHogStorage() {
	if (typeof window === "undefined") return;

	for (const storage of [window.localStorage, window.sessionStorage]) {
		for (let index = storage.length - 1; index >= 0; index -= 1) {
			const key = storage.key(index);
			if (
				key &&
				POSTHOG_STORAGE_PREFIXES.some((prefix) =>
					key.toLowerCase().startsWith(prefix),
				)
			) {
				storage.removeItem(key);
			}
		}
	}
}

async function initializePostHog() {
	const apiHost = getPostHogApiHost();
	const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
	if (posthogInitialized) return true;
	if (
		analyticsMode !== "granted" ||
		typeof window === "undefined" ||
		!key ||
		!apiHost
	) {
		return posthogInitialized;
	}
	if (posthogInitialization) return posthogInitialization;

	posthogInitialization = import("posthog-js")
		.then(({ default: posthog }) => {
			// Consent may have been withdrawn while the SDK chunk was loading.
			if (analyticsMode !== "granted") return false;
			posthogClient = posthog;
			posthog.init(key, {
		defaults: "2026-06-25",
		api_host: apiHost,
		ui_host: getPostHogUiHost(apiHost),
		autocapture: {
			dom_event_allowlist: ["click", "change", "submit"],
			element_allowlist: [
				"a",
				"button",
				"form",
				"input",
				"select",
				"textarea",
				"label",
			],
			css_selector_ignorelist: [
				".ph-no-capture",
				"[data-ph-no-autocapture]",
				"[data-analytics-sensitive]",
				"[data-analytics-block]",
			],
			capture_copied_text: false,
		},
		capture_pageview: false,
		capture_pageleave: true,
		capture_performance: {
			network_timing: false,
			web_vitals: true,
			web_vitals_attribution: ["INP", "LCP"],
		},
		capture_dead_clicks: true,
		capture_heatmaps: true,
		capture_exceptions: false,
		disable_session_recording: true,
		session_recording: {
			blockSelector: "[data-analytics-block], .ph-no-capture",
			maskTextSelector: "*",
			maskAllInputs: true,
			maskAllElementAttributes: true,
			recordHeaders: false,
			recordBody: false,
			recordCrossOriginIframes: false,
			captureCanvas: { recordCanvas: false },
			captureJsonLd: false,
		},
		enable_recording_console_log: false,
		mask_all_element_attributes: true,
		mask_all_text: true,
		mask_personal_data_properties: true,
		person_profiles: "identified_only",
		opt_out_capturing_by_default: true,
		opt_out_persistence_by_default: true,
		respect_dnt: true,
		save_campaign_params: true,
		save_referrer: false,
		before_send: sanitizePostHogEvent,
			});

			posthogInitialized = true;
			analyticsDebug("PostHog SDK initialized");
			return true;
		})
		.catch((error) => {
			console.error("Failed to initialize PostHog", error);
			return false;
		})
		.finally(() => {
			if (!posthogInitialized) posthogInitialization = null;
		});

	return posthogInitialization;
}

async function ensurePostHogReady() {
	if (analyticsMode !== "granted" || !analyticsPreferences.analytics) {
		return null;
	}
	if (!(await initializePostHog()) || !posthogClient) return null;
	if (analyticsMode !== "granted" || !analyticsPreferences.analytics) {
		return null;
	}

	const locale = document.documentElement.lang || "unknown";
	const consentSignature = `${ANALYTICS_CONSENT_POLICY_VERSION}:${locale}:${analyticsPreferences.sessionReplay}`;
	if (appliedPostHogConsentSignature !== consentSignature) {
		posthogClient.opt_in_capturing({ captureEventName: false });
		posthogClient.setPersonProperties({
			consent_policy_version: ANALYTICS_CONSENT_POLICY_VERSION,
			locale,
			session_replay_enabled: analyticsPreferences.sessionReplay,
		});
		if (analyticsPreferences.sessionReplay) {
			posthogClient.startSessionRecording();
		} else {
			posthogClient.stopSessionRecording();
		}
		appliedPostHogConsentSignature = consentSignature;
		analyticsDebug("PostHog consent applied", {
			sessionReplay: analyticsPreferences.sessionReplay,
		});
	}
	startClientErrorTracking();
	return posthogClient;
}

function withPostHog(
	capture: (client: PostHogBrowserClient) => void,
) {
	if (analyticsMode !== "granted") return;
	void ensurePostHogReady().then((client) => {
		if (client && analyticsMode === "granted") capture(client);
	});
}

function clientErrorType(value: unknown) {
	if (value instanceof Error && value.name) return value.name.slice(0, 80);
	if (value && typeof value === "object") {
		const name = Reflect.get(value, "name");
		if (typeof name === "string" && name) return name.slice(0, 80);
	}
	return "UnknownError";
}

function startClientErrorTracking() {
	if (
		removeClientErrorListeners ||
		analyticsMode !== "granted" ||
		!posthogClient ||
		typeof window === "undefined"
	) {
		return;
	}

	const onError = (event: ErrorEvent) => {
		posthogClient?.capture("client_error", {
			error_type: clientErrorType(event.error),
			source: "window_error",
		});
	};
	const onUnhandledRejection = (event: PromiseRejectionEvent) => {
		posthogClient?.capture("client_error", {
			error_type: clientErrorType(event.reason),
			source: "unhandled_rejection",
		});
	};

	window.addEventListener("error", onError);
	window.addEventListener("unhandledrejection", onUnhandledRejection);
	removeClientErrorListeners = () => {
		window.removeEventListener("error", onError);
		window.removeEventListener("unhandledrejection", onUnhandledRejection);
		removeClientErrorListeners = null;
	};
}

function sendRejectedAggregateEvent(
	event:
		| "page_view"
		| "attachment_interaction"
		| "library_results_loaded"
		| "content_action",
	properties: Record<string, unknown>,
) {
	if (analyticsMode !== "denied" || typeof window === "undefined") return;

	void fetch("/api/analytics/events", {
		method: "POST",
		credentials: "same-origin",
		keepalive: true,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ event, properties }),
	}).catch(() => {
		// Analytics must never interfere with the application experience.
	});
}

export function applyClientAnalyticsConsent(
	state: AnalyticsConsentState,
	preferences: AnalyticsConsentPreferences,
) {
	analyticsMode = state;
	analyticsPreferences = preferences;
	analyticsDebug("Consent state applied", {
		state,
		sessionReplay: preferences.sessionReplay,
	});

	if (state !== "granted" || !preferences.analytics) {
		removeClientErrorListeners?.();
		if (typeof window !== "undefined") {
			window.gtag?.("consent", "update", getGoogleConsentUpdate(false));
		}
		resetGoogleAnalyticsState();
		appliedPostHogConsentSignature = null;
		if (posthogClient) {
			posthogClient.stopSessionRecording();
			posthogClient.reset(true);
			posthogClient.opt_out_capturing();
		}
		clearCookies([...GOOGLE_COOKIE_PREFIXES, ...POSTHOG_STORAGE_PREFIXES]);
		clearPostHogStorage();
		if (typeof window !== "undefined") {
			window.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
		}
		return false;
	}

	void ensurePostHogReady();
	return true;
}

export function getAnalyticsDistinctId() {
	if (analyticsMode !== "granted" || !posthogClient) return null;
	return posthogClient.get_distinct_id();
}

export function registerAnalyticsAttribution(
	attribution: AnalyticsAttribution,
) {
	if (analyticsMode !== "granted") return;

	const sanitized = Object.fromEntries(
		Object.entries(attribution)
			.filter(([, value]) => typeof value === "string" && value.length > 0)
			.map(([key, value]) => [key, sanitizeString(value).slice(0, 100)]),
	);
	if (Object.keys(sanitized).length === 0) return;

	withPostHog((posthog) => {
		posthog.register(sanitized);
		posthog.setPersonProperties(
			undefined,
			Object.fromEntries(
				Object.entries(sanitized).map(([key, value]) => [
					`initial_${key}`,
					value,
				]),
			),
		);
	});
}

export function prepareGoogleAnalytics(measurementId: string) {
	if (analyticsMode !== "granted") return;
	googleAnalyticsMeasurementId = measurementId;
	googleAnalyticsReady = false;
	if (typeof window !== "undefined") {
		window[`ga-disable-${measurementId}`] = false;
	}
}

export function markGoogleAnalyticsReady(measurementId: string) {
	if (analyticsMode !== "granted") return;
	googleAnalyticsMeasurementId = measurementId;
	googleAnalyticsReady = true;
	flushQueuedGoogleEvents();
}

export function resetGoogleAnalytics() {
	resetGoogleAnalyticsState();
}

export function updateGoogleConsent(granted: boolean) {
	if (typeof window === "undefined") return;
	gtag("consent", "update", getGoogleConsentUpdate(granted));
}

export function trackPageView(path?: string) {
	const pagePath = sanitizeAnalyticsPath(
		path || (typeof window !== "undefined" ? window.location.pathname : "/"),
	);

	if (analyticsMode === "denied") {
		sendRejectedAggregateEvent("page_view", { pagePath });
		return;
	}
	if (analyticsMode !== "granted") return;

	sendGoogleEvent("page_view", {
		page_path: pagePath,
		page_location:
			typeof window === "undefined"
				? pagePath
				: `${window.location.origin}${pagePath}`,
	});
	withPostHog((posthog) => {
		posthog.capture("$pageview", {
			$current_url:
				typeof window === "undefined"
					? pagePath
					: `${window.location.origin}${pagePath}`,
			$pathname: pagePath,
		});
		analyticsDebug("PostHog page view submitted to SDK");
	});
}

export function trackAttachmentInteraction(
	payload: AttachmentAnalyticsPayload,
) {
	const properties = {
		action: payload.action,
		locale: payload.locale,
		parentType: payload.parentType || "unknown",
		source: payload.source,
		isAuthenticated: payload.isAuthenticated,
	};

	if (analyticsMode === "denied") {
		sendRejectedAggregateEvent("attachment_interaction", properties);
		return;
	}
	if (analyticsMode !== "granted") return;

	sendGoogleEvent("attachment_interaction", {
		engagement_time_msec: 1,
		action: properties.action,
		locale: properties.locale,
		parent_type: properties.parentType,
		source: properties.source,
		is_authenticated: properties.isAuthenticated,
	});
	withPostHog((posthog) => {
		posthog.capture("attachment_interaction", properties);
	});
}

export function trackLibraryResultsLoaded(
	payload: LibraryResultsAnalyticsPayload,
) {
	const properties = {
		has_search: payload.hasSearch,
		filter_count: Math.max(0, Math.floor(payload.filterCount)),
		page: Math.max(1, Math.floor(payload.page)),
		page_result_count: Math.max(0, Math.floor(payload.pageResultCount)),
		total_result_count: Math.max(0, Math.floor(payload.totalResultCount)),
		scope: payload.scope.slice(0, 80),
		sort: payload.sort.slice(0, 80),
	};

	if (analyticsMode === "denied") {
		sendRejectedAggregateEvent("library_results_loaded", properties);
		return;
	}
	if (analyticsMode !== "granted") return;

	sendGoogleEvent("view_search_results", {
		search_term: payload.hasSearch ? "present" : "absent",
		...properties,
	});
	withPostHog((posthog) => {
		posthog.capture("library_results_loaded", properties);
	});
}

export function trackContentAction(payload: ContentActionAnalyticsPayload) {
	const properties = {
		action: payload.action,
		context: payload.context,
		format: payload.format.slice(0, 30),
	};

	if (analyticsMode === "denied") {
		sendRejectedAggregateEvent("content_action", properties);
		return;
	}
	if (analyticsMode !== "granted") return;

	sendGoogleEvent("content_action", properties);
	withPostHog((posthog) => {
		posthog.capture("content_action", properties);
	});
}
