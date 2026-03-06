"use client";

import posthog from "posthog-js";

declare global {
	interface Window {
		dataLayer?: unknown[];
		gtag?: (...args: unknown[]) => void;
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

let analyticsEnabled = false;
let analyticsInitialized = false;
let googleAnalyticsMeasurementId: string | null = null;
let googleAnalyticsReady = false;

type QueuedGoogleEvent = {
	eventName: string;
	params: Record<string, unknown>;
};

const queuedGoogleEvents: QueuedGoogleEvent[] = [];

function gtag(...args: unknown[]) {
	if (typeof window === "undefined") {
		return;
	}

	if (typeof window.gtag === "function") {
		window.gtag(...args);
		return;
	}

	window.dataLayer = window.dataLayer || [];
	window.dataLayer.push(args);
}

function resetGoogleAnalyticsState() {
	googleAnalyticsMeasurementId = null;
	googleAnalyticsReady = false;
	queuedGoogleEvents.length = 0;
}

function sendGoogleEvent(
	eventName: string,
	params: Record<string, unknown>
) {
	if (!googleAnalyticsMeasurementId) {
		return;
	}

	if (!googleAnalyticsReady) {
		queuedGoogleEvents.push({
			eventName,
			params,
		});
		return;
	}

	gtag("event", eventName, {
		send_to: googleAnalyticsMeasurementId,
		...params,
	});
}

function flushQueuedGoogleEvents() {
	if (!googleAnalyticsReady || !googleAnalyticsMeasurementId) {
		return;
	}

	while (queuedGoogleEvents.length > 0) {
		const nextEvent = queuedGoogleEvents.shift();
		if (!nextEvent) {
			continue;
		}

		gtag("event", nextEvent.eventName, {
			send_to: googleAnalyticsMeasurementId,
			...nextEvent.params,
		});
	}
}

export function sanitizeAnalyticsPath(path: string | undefined | null) {
	if (!path) {
		return "/";
	}

	try {
		const url = new URL(path, "https://analytics.local");
		return url.pathname || "/";
	} catch {
		const sanitized = path.split("?")[0]?.split("#")[0];
		return sanitized || "/";
	}
}

function getGoogleConsentUpdate(granted: boolean) {
	return {
		ad_storage: "denied",
		ad_user_data: "denied",
		ad_personalization: "denied",
		analytics_storage: granted ? "granted" : "denied",
	};
}

function clearCookie(name: string) {
	if (typeof document === "undefined") {
		return;
	}

	const base =
		`${name}=; Max-Age=0; Path=/; SameSite=Lax; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
	document.cookie = base;
	document.cookie = `${base}; Domain=${window.location.hostname}`;
}

function clearVendorCookies() {
	if (typeof document === "undefined") {
		return;
	}

	const cookieNames = document.cookie
		.split(";")
		.map((cookie) => cookie.trim().split("=")[0])
		.filter(Boolean);

	for (const cookieName of cookieNames) {
		if (
			cookieName.startsWith("_ga") ||
			cookieName.startsWith("_gid") ||
			cookieName.startsWith("_gat") ||
			cookieName.startsWith("ph_")
		) {
			clearCookie(cookieName);
		}
	}
}

function clearVendorLocalStorage() {
	if (typeof window === "undefined") {
		return;
	}

	const keysToDelete: string[] = [];
	for (let index = 0; index < window.localStorage.length; index++) {
		const key = window.localStorage.key(index);
		if (!key) {
			continue;
		}

		if (
			key.startsWith("ph_") ||
			key.startsWith("posthog") ||
			key === "posthog-opted" ||
			key === "utm:active"
		) {
			keysToDelete.push(key);
		}
	}

	for (const key of keysToDelete) {
		window.localStorage.removeItem(key);
	}
}

export function clearAnalyticsStorage() {
	if (typeof window !== "undefined") {
		window.gtag?.("consent", "update", getGoogleConsentUpdate(false));
	}

	resetGoogleAnalyticsState();

	if (analyticsInitialized) {
		posthog.opt_out_capturing();
		posthog.reset();
	}

	analyticsEnabled = false;
	analyticsInitialized = false;
	clearVendorCookies();
	clearVendorLocalStorage();
}

export function prepareGoogleAnalytics(measurementId: string) {
	googleAnalyticsMeasurementId = measurementId;
	googleAnalyticsReady = false;
}

export function markGoogleAnalyticsReady(measurementId: string) {
	googleAnalyticsMeasurementId = measurementId;
	googleAnalyticsReady = true;
	flushQueuedGoogleEvents();
}

export function resetGoogleAnalytics() {
	resetGoogleAnalyticsState();
}

export function initializeClientAnalytics() {
	if (analyticsInitialized) {
		analyticsEnabled = true;
		posthog.opt_in_capturing({
			captureEventName: false,
		});
		return true;
	}

	if (
		typeof window === "undefined" ||
		!process.env.NEXT_PUBLIC_POSTHOG_KEY ||
		!process.env.NEXT_PUBLIC_POSTHOG_HOST
	) {
		analyticsEnabled = false;
		return false;
	}

	posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
		advanced_disable_feature_flags_on_first_load: true,
		api_host: "/backend",
		autocapture: false,
		capture_pageleave: false,
		capture_pageview: false,
		disable_session_recording: true,
		mask_all_element_attributes: true,
		mask_all_text: true,
		mask_personal_data_properties: true,
		opt_out_capturing_by_default: true,
		person_profiles: "never",
		persistence: "localStorage+cookie",
		respect_dnt: true,
		ui_host: "https://us.posthog.com",
	});
	posthog.opt_in_capturing({
		captureEventName: false,
	});

	analyticsEnabled = true;
	analyticsInitialized = true;
	return true;
}

export function getAnalyticsDistinctId() {
	if (!analyticsEnabled || !analyticsInitialized) {
		return null;
	}

	return posthog.get_distinct_id();
}

export function updateGoogleConsent(granted: boolean) {
	if (typeof window === "undefined") {
		return;
	}

	gtag("consent", "update", getGoogleConsentUpdate(granted));
}

export function trackPageView(path?: string) {
	if (!analyticsEnabled) {
		return;
	}

	const pagePath = sanitizeAnalyticsPath(
		path || (typeof window !== "undefined" ? window.location.pathname : "/")
	);

	sendGoogleEvent("page_view", {
		page_path: pagePath,
	});

	posthog.capture("page_view", {
		pagePath,
	});
}

export function trackAttachmentInteraction(
	payload: AttachmentAnalyticsPayload
) {
	if (!analyticsEnabled) {
		return;
	}

	const basePayload = {
		action: payload.action,
		locale: payload.locale,
		parent_type: payload.parentType || "unknown",
		source: payload.source,
		is_authenticated: payload.isAuthenticated,
	};

	sendGoogleEvent("attachment_interaction", {
		engagement_time_msec: 1,
		...basePayload,
	});

	posthog.capture("attachment_interaction", {
		action: payload.action,
		locale: payload.locale,
		parentType: payload.parentType || "unknown",
		source: payload.source,
		isAuthenticated: payload.isAuthenticated,
	});
}
