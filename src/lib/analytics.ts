"use client";

import { StoredUtm, UTM_KEYS } from "@/components/features/UtmProvider";
import type { LibraryPublicConfig } from "@/config/library-config/schema";
import { PostHog } from "posthog-js";

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
	if (!analyticsEnabled) {
		return;
	}

	const event = {
		engagement_time_msec: 1,
		method: "download",
		...params,
	};
	sendGoogleEvent("pdf_download", event);
	posthogClient?.capture(
		"download_attachment",
		payloadToPosthog(params),
	);
}

export function trackPDFView(params: PdfEventParams) {
	if (!analyticsEnabled) {
		return;
	}

	const event = {
		engagement_time_msec: 1,
		method: "view",
		...params,
	};
	sendGoogleEvent("pdf_view", event);
	posthogClient?.capture("view_attachment", payloadToPosthog(params));
}

function payloadToPosthog(params: PdfEventParams) {
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
let posthogClient: PostHog | null = null;
let posthogConfiguration: LibraryPublicConfig["analytics"]["posthog"] | null =
	null;
let googleAnalyticsMeasurementId: string | null = null;
let googleAnalyticsReady = false;

type QueuedGoogleEvent = {
	eventName: string;
	params: Record<string, unknown>;
};

const queuedGoogleEvents: QueuedGoogleEvent[] = [];

function posthogConfigurationsEqual(
	left: LibraryPublicConfig["analytics"]["posthog"] | null,
	right: LibraryPublicConfig["analytics"]["posthog"],
) {
	return left?.host === right.host && left?.key === right.key;
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

	posthogClient?.opt_out_capturing();

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

export function initializePostHog(
	configuration: LibraryPublicConfig["analytics"]["posthog"],
) {
	if (typeof window === "undefined") {
		return false;
	}

	if (!configuration.host || !configuration.key) {
		posthogClient?.opt_out_capturing();
		posthogClient = null;
		posthogConfiguration = null;
		return false;
	}

	if (
		posthogClient &&
		posthogConfigurationsEqual(posthogConfiguration, configuration)
	) {
		return true;
	}

	posthogClient?.opt_out_capturing();
	const nextClient = new PostHog();
	nextClient.init(configuration.key, {
		advanced_disable_flags: true,
		advanced_disable_feature_flags_on_first_load: true,
		api_host: configuration.host,
		autocapture: false,
		capture_pageleave: false,
		capture_pageview: false,
		disable_external_dependency_loading: true,
		disable_session_recording: true,
		mask_all_element_attributes: true,
		mask_all_text: true,
		mask_personal_data_properties: true,
		opt_out_persistence_by_default: true,
		person_profiles: "never",
		respect_dnt: true,
	});

	posthogClient = nextClient;
	posthogConfiguration = configuration;
	return true;
}

export function initializeClientAnalytics(
	configuration: LibraryPublicConfig["analytics"],
) {
	const measurementId = configuration.google.measurementId;
	if (measurementId) {
		if (googleAnalyticsMeasurementId !== measurementId) {
			prepareGoogleAnalytics(measurementId);
		}
	} else {
		resetGoogleAnalyticsState();
	}

	const posthogAvailable = initializePostHog(configuration.posthog);
	if (posthogAvailable) {
		posthogClient?.opt_in_capturing({
			captureEventName: false,
		});
	}

	analyticsEnabled =
		posthogAvailable || Boolean(measurementId);
	return analyticsEnabled;
}

export function getAnalyticsDistinctId() {
	if (!analyticsEnabled || !posthogClient) {
		return null;
	}

	return posthogClient.get_distinct_id();
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

	posthogClient?.capture("page_view", {
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

	posthogClient?.capture("attachment_interaction", {
		action: payload.action,
		locale: payload.locale,
		parentType: payload.parentType || "unknown",
		source: payload.source,
		isAuthenticated: payload.isAuthenticated,
	});
}
