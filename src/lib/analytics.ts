"use client";

import type { LibraryPublicConfig } from "@/config/library-config/schema";
import type {
	AnalyticsConsentPreferences,
	AnalyticsConsentState,
} from "@/lib/analytics-consent";
import { sanitizeAnalyticsPath } from "@/lib/analytics-shared";
import type {
	CaptureResult,
	PostHog,
} from "posthog-js/dist/module.full.no-external";

declare global {
	interface Window {
		dataLayer?: unknown[];
		gtag?: (...args: unknown[]) => void;
		[key: `ga-disable-${string}`]: boolean | unknown;
	}
}

export type ClientAnalyticsConfiguration = {
	analytics: LibraryPublicConfig["analytics"];
	scope: string;
};

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
	categoricalFilters?: Partial<
		Record<
			"collection" | "country" | "institution" | "year_range",
			string | string[]
		>
	>;
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

type QueuedGoogleEvent = {
	eventName: string;
	params: Record<string, unknown>;
};

const GOOGLE_COOKIE_PREFIXES = ["_ga", "_gid", "_gat"];
const POSTHOG_STORAGE_PREFIXES = ["ph_", "__ph_", "posthog"];
const SENSITIVE_PROPERTY_NAME =
	/^\$(?:initial_)?referrer$|(^|_)(abstract|authorization|body|chat|content|email|file(name|_name)?|link_(text|url)|message|parent_title|password|pdf|prompt|query|response|search_(body|query|term)|text|title|token|transcript|user_id)(_|$)/i;
const REPLAY_LAYOUT_ATTRIBUTES = new Set([
	"class", "style", "_csstext", "rel", "type", "media",
	"width", "height", "viewbox", "d", "fill", "stroke", "stroke-width",
	"stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule", "transform",
	"x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry",
	"data-state", "data-theme", "data-slot", "data-open", "data-selected",
]);

function maskReplayAttribute(name: string, value: string) {
	const attribute = name.toLowerCase();
	if (attribute === "style" || attribute === "_csstext") {
		// CSS keeps the layout, but resource URLs can contain private values.
		return value.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/giu, "url(about:blank)");
	}
	return REPLAY_LAYOUT_ATTRIBUTES.has(attribute)
		? value
		: "*".repeat(value.length);
}

let analyticsMode: AnalyticsConsentState = "pending";
let analyticsPreferences: AnalyticsConsentPreferences = {
	analytics: false,
	sessionReplay: false,
};
let activeConfiguration: ClientAnalyticsConfiguration | null = null;
let activeSignature: string | null = null;
let posthogClient: PostHog | null = null;
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

function configurationSignature(configuration: ClientAnalyticsConfiguration) {
	const { analytics, scope } = configuration;
	return [
		scope,
		analytics.consentPolicyVersion,
		analytics.posthog.host ?? "",
		analytics.posthog.uiHost ?? "",
		analytics.posthog.key ?? "",
		analytics.google.measurementId ?? "",
	].join("|");
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
	if (typeof window !== "undefined" && googleAnalyticsMeasurementId) {
		window[`ga-disable-${googleAnalyticsMeasurementId}`] = true;
	}
	googleAnalyticsMeasurementId = null;
	googleAnalyticsReady = false;
	queuedGoogleEvents.length = 0;
}

function sendGoogleEvent(eventName: string, params: Record<string, unknown>) {
	if (analyticsMode !== "granted" || !googleAnalyticsMeasurementId) return;
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
		typeof window === "undefined"
			? "https://analytics.local"
			: window.location.origin;
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

function sanitizePostHogValue(value: unknown): unknown {
	if (typeof value === "string") return sanitizeString(value);
	if (Array.isArray(value)) return value.map(sanitizePostHogValue);
	if (value && typeof value === "object")
		return sanitizePostHogProperties(value as Record<string, unknown>);
	return value;
}

function sanitizePostHogPropertyValue(key: string, value: unknown) {
	// rrweb masks snapshots before capture. Recursively rewriting their CSS,
	// attribute names or text nodes corrupts the replay protocol.
	if (key === "$snapshot_data") return value;
	if (key === "$current_url") return sanitizedCurrentUrl(value);
	if (key === "$pathname") return sanitizeAnalyticsPath(String(value ?? "/"));
	return sanitizePostHogValue(value);
}

function sanitizePostHogProperties(
	properties: Record<string, unknown>,
	preserveProjectToken = false,
): Record<string, unknown> {
	const sanitized = new Map<string, unknown>();
	for (const [key, value] of Object.entries(properties)) {
		// PostHog's public project token is required for event ingestion.
		if (key === "token" && preserveProjectToken) {
			sanitized.set(key, value);
			continue;
		}
		if (SENSITIVE_PROPERTY_NAME.test(key)) continue;
		const safeKey = sanitizeString(key);
		const safeValue = sanitizePostHogPropertyValue(key, value);
		// Heatmap URLs are object keys. Combine points when query variants
		// become the same URL after sanitizing them.
		const previous = sanitized.get(safeKey);
		sanitized.set(safeKey,
			Array.isArray(previous) && Array.isArray(safeValue)
				? [...previous, ...safeValue]
				: safeValue,
		);
	}
	return Object.fromEntries(sanitized);
}

function sanitizePostHogEvent(event: CaptureResult | null) {
	if (!event || analyticsMode !== "granted") return null;
	return {
		...event,
		...(event.$set && { $set: sanitizePostHogProperties(event.$set) }),
		...(event.$set_once && {
			$set_once: sanitizePostHogProperties(event.$set_once),
		}),
		properties: sanitizePostHogProperties(event.properties, true),
	};
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

function teardownPostHog() {
	removeClientErrorListeners?.();
	if (posthogClient) {
		posthogClient.stopSessionRecording();
		posthogClient.reset(true);
		posthogClient.opt_out_capturing();
	}
	posthogClient = null;
	posthogInitialization = null;
	appliedPostHogConsentSignature = null;
	clearCookies(POSTHOG_STORAGE_PREFIXES);
	clearPostHogStorage();
}

async function initializePostHog(expectedSignature: string) {
	if (posthogClient) return true;
	const configuration = activeConfiguration;
	if (
		analyticsMode !== "granted" ||
		typeof window === "undefined" ||
		!configuration?.analytics.posthog.key ||
		!configuration.analytics.posthog.host ||
		activeSignature !== expectedSignature
	) {
		return false;
	}
	if (posthogInitialization) return posthogInitialization;

	posthogInitialization = import("posthog-js/dist/module.full.no-external")
		.then(({ PostHog: PostHogClient }) => {
			if (
				analyticsMode !== "granted" ||
				activeSignature !== expectedSignature ||
				!activeConfiguration
			) {
				return false;
			}

			const posthog = activeConfiguration.analytics.posthog;
			if (!posthog.key || !posthog.host) return false;
			const nextClient = new PostHogClient();
			nextClient.init(posthog.key, {
				defaults: "2026-06-25",
				api_host: posthog.host,
				ui_host: posthog.uiHost ?? posthog.host,
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
					maskAllElementAttributes: false,
					maskAttributeFn: maskReplayAttribute,
					maskCapturedNetworkRequestFn: (request) => ({
						...request,
						name: request.name ? sanitizedCurrentUrl(request.name) : request.name,
					}),
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
				person_profiles: "always",
				respect_dnt: true,
				save_campaign_params: true,
				save_referrer: false,
				before_send: sanitizePostHogEvent,
			});
			posthogClient = nextClient;
			analyticsDebug("PostHog SDK initialized", {
				scope: activeConfiguration.scope,
			});
			return true;
		})
		.catch((error) => {
			console.error("Failed to initialize PostHog", error);
			return false;
		})
		.finally(() => {
			if (!posthogClient) posthogInitialization = null;
		});

	return posthogInitialization;
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
		!posthogClient ||
		typeof window === "undefined"
	)
		return;
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

async function getReadyPostHog() {
	if (
		analyticsMode !== "granted" ||
		!analyticsPreferences.analytics ||
		!activeSignature
	) {
		return null;
	}
	const expectedSignature = activeSignature;
	if (!(await initializePostHog(expectedSignature))) return null;
	if (!posthogClient || !activeConfiguration) return null;
	return {
		client: posthogClient,
		configuration: activeConfiguration,
		expectedSignature,
	};
}

function applyPostHogPreferences({
	client,
	configuration,
	expectedSignature,
}: NonNullable<Awaited<ReturnType<typeof getReadyPostHog>>>) {
	const locale = document.documentElement.lang || "unknown";
	const consentSignature = [
		expectedSignature,
		locale,
		analyticsPreferences.sessionReplay,
	].join("|");
	if (appliedPostHogConsentSignature === consentSignature) return;

	client.opt_in_capturing({ captureEventName: false });
	client.setPersonProperties({
		consent_policy_version: configuration.analytics.consentPolicyVersion,
		locale,
		session_replay_enabled: analyticsPreferences.sessionReplay,
		tenant_scope: configuration.scope,
	});
	if (analyticsPreferences.sessionReplay) {
		client.startSessionRecording();
	} else {
		client.stopSessionRecording();
	}
	appliedPostHogConsentSignature = consentSignature;
}

async function applyPostHogConsent() {
	const readyPostHog = await getReadyPostHog();
	if (!readyPostHog) return false;
	applyPostHogPreferences(readyPostHog);
	startClientErrorTracking();
	return true;
}

function withPostHog(capture: (client: PostHog) => void) {
	if (analyticsMode !== "granted") return;
	void applyPostHogConsent().then((ready) => {
		if (ready && posthogClient && analyticsMode === "granted")
			capture(posthogClient);
	});
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
		// Analytics must never interrupt the application.
	});
}

export async function applyClientAnalyticsConsent(
	configuration: ClientAnalyticsConfiguration,
	state: AnalyticsConsentState,
	preferences: AnalyticsConsentPreferences,
) {
	const nextSignature = configurationSignature(configuration);
	if (activeSignature !== nextSignature) {
		teardownPostHog();
		resetGoogleAnalyticsState();
		activeConfiguration = configuration;
		activeSignature = nextSignature;
	}

	analyticsMode = state;
	analyticsPreferences = {
		analytics: state === "granted" && preferences.analytics,
		sessionReplay:
			state === "granted" &&
			preferences.analytics &&
			preferences.sessionReplay,
	};
	analyticsDebug("Consent state applied", {
		state,
		scope: configuration.scope,
		sessionReplay: analyticsPreferences.sessionReplay,
	});

	if (state !== "granted" || !analyticsPreferences.analytics) {
		if (typeof window !== "undefined") {
			window.gtag?.("consent", "update", getGoogleConsentUpdate(false));
		}
		resetGoogleAnalyticsState();
		teardownPostHog();
		clearCookies(GOOGLE_COOKIE_PREFIXES);
		return false;
	}

	const measurementId = configuration.analytics.google.measurementId;
	if (measurementId) prepareGoogleAnalytics(measurementId);
	const posthogReady = await applyPostHogConsent();
	return posthogReady || Boolean(measurementId);
}

export function clearAnalyticsStorage() {
	analyticsMode = "pending";
	analyticsPreferences = { analytics: false, sessionReplay: false };
	if (typeof window !== "undefined") {
		window.gtag?.("consent", "update", getGoogleConsentUpdate(false));
	}
	resetGoogleAnalyticsState();
	teardownPostHog();
	clearCookies(GOOGLE_COOKIE_PREFIXES);
}

export function getAnalyticsDistinctId() {
	if (analyticsMode !== "granted" || !posthogClient) return null;
	return posthogClient.get_distinct_id();
}

export function prepareGoogleAnalytics(measurementId: string) {
	if (analyticsMode !== "granted") return;
	googleAnalyticsMeasurementId = measurementId;
	googleAnalyticsReady = false;
	if (typeof window !== "undefined")
		window[`ga-disable-${measurementId}`] = false;
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
		path ||
			(typeof window !== "undefined" ? window.location.pathname : "/"),
	);
	if (analyticsMode === "denied") {
		sendRejectedAggregateEvent("page_view", { pagePath });
		return;
	}
	if (analyticsMode !== "granted") return;

	const pageLocation =
		typeof window === "undefined"
			? pagePath
			: `${window.location.origin}${pagePath}`;
	sendGoogleEvent("page_view", {
		page_path: pagePath,
		page_location: pageLocation,
	});
	withPostHog((posthog) => {
		posthog.capture("$pageview", {
			$current_url: pageLocation,
			$pathname: pagePath,
		});
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
	withPostHog((posthog) =>
		posthog.capture("attachment_interaction", properties),
	);
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
	const categoricalFilters = Object.fromEntries(
		Object.entries(payload.categoricalFilters ?? {}).flatMap(
			([key, value]) => {
				const values = (Array.isArray(value) ? value : [value])
					.filter(
						(entry): entry is string => typeof entry === "string",
					)
					.map((entry) => entry.trim().slice(0, 80))
					.filter(Boolean)
					.slice(0, 50);
				return values.length > 0 ? [[`filter_${key}`, values]] : [];
			},
		),
	);
	sendGoogleEvent("view_search_results", {
		search_term: payload.hasSearch ? "present" : "absent",
		...properties,
	});
	withPostHog((posthog) =>
		posthog.capture("library_results_loaded", {
			...properties,
			...categoricalFilters,
		}),
	);
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
	withPostHog((posthog) => posthog.capture("content_action", properties));
}
