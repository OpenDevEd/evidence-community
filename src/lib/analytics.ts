"use client";

import { StoredUtm, UTM_KEYS } from "@/components/features/UtmProvider";
import { sendGAEvent } from "@next/third-parties/google";
import posthog from "posthog-js";

declare global {
	interface Window {
		// eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
		dataLayer?: Object[];
		gtag?: (...args: unknown[]) => void;
	}
}

export type PdfEventParams = {
	file_id: string;
	filename: string;
	file_title?: string;
	parent_type?: string;
	parent_id?: string;
	parent_title?: string;
	file_size_bytes?: number;
	file_mime_type?: string;
	link_url?: string;
	link_text?: string;
	method?: "view" | "download" | "open";
	file_md5?: string;
	posthog_distinct_id?: string;
	user_id?: string;
} & StoredUtm["utm"];

export function trackPDFDownload(params: PdfEventParams) {
	sendGAEvent("event", "pdf_download", {
		engagement_time_msec: 1,
		method: "download",
		...params,
	});
}

export function trackPDFView(params: PdfEventParams) {
	sendGAEvent("event", "pdf_view", {
		engagement_time_msec: 1,
		method: "view",
		...params,
	});
}

export function payloadToPosthog(params: PdfEventParams) {
	const payload: Record<string, unknown> = {
		key: params.file_id,
		filename: params.filename,
		fileTitle: params.file_title,
		parentKey: params.parent_id,
		parentTitle: params.parent_title,
		parentType: params.parent_type,
		fileMimeType: params.file_mime_type,
		fileMd5: params.file_md5,
		linkText: params.link_text,
		linkUrl: params.link_url,
		userId: params.user_id,
	};

	for (const key of UTM_KEYS) {
		if (params[key]) {
			payload[key] = params[key];
		}
	}

	return payload;
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
let posthogInitialized = false;
let googleAnalyticsMeasurementId: string | null = null;
let googleAnalyticsReady = false;

type QueuedGoogleEvent = {
	eventName: string;
	params: Record<string, unknown>;
};

const queuedGoogleEvents: QueuedGoogleEvent[] = [];

function getPostHogApiHost() {
	return process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();
}

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

function clearGACookies() {
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
			cookieName.startsWith("_gat")
		) {
			const base =
				`${cookieName}=; Max-Age=0; Path=/; SameSite=Lax; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
			document.cookie = base;
			document.cookie = `${base}; Domain=${window.location.hostname}`;
			document.cookie = `${base}; Domain=.${window.location.hostname}`;
			const parts = window.location.hostname.split(".");
			if (parts.length > 2) {
				document.cookie = `${base}; Domain=.${parts.slice(1).join(".")}`;
			}
		}
	}
}

export function clearAnalyticsStorage() {
	if (typeof window !== "undefined") {
		window.gtag?.("consent", "update", getGoogleConsentUpdate(false));
	}

	resetGoogleAnalyticsState();

	if (posthogInitialized) {
		posthog.opt_out_capturing();
	}

	analyticsEnabled = false;
	clearGACookies();
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

export function initializePostHog() {
	if (
		posthogInitialized ||
		typeof window === "undefined" ||
		!process.env.NEXT_PUBLIC_POSTHOG_KEY ||
		!getPostHogApiHost()
	) {
		return;
	}

	posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
		advanced_disable_feature_flags_on_first_load: true,
		api_host: getPostHogApiHost(),
		autocapture: false,
		capture_pageleave: false,
		capture_pageview: false,
		cookieless_mode: "on_reject",
		disable_session_recording: true,
		mask_all_element_attributes: true,
		mask_all_text: true,
		mask_personal_data_properties: true,
		person_profiles: "never",
		respect_dnt: true,
		ui_host: "https://us.posthog.com",
	});

	posthogInitialized = true;
}

export function initializeClientAnalytics() {
	if (!posthogInitialized) {
		initializePostHog();
	}

	if (!posthogInitialized) {
		analyticsEnabled = false;
		return false;
	}

	posthog.opt_in_capturing({
		captureEventName: false,
	});

	analyticsEnabled = true;
	return true;
}

export function getAnalyticsDistinctId() {
	if (!analyticsEnabled || !posthogInitialized) {
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
