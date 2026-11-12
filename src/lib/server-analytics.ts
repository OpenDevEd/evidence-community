import "server-only";

import { createHash } from "node:crypto";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import {
	analyticsConsentPolicy,
	analyticsConsentState,
	readAnalyticsConsentCookieHeader,
} from "@/lib/analytics-consent";
import { getPostHogForConfig } from "@/lib/posthog";

export type ServerAnalyticsContext =
	{ mode: "consented"; distinctId: string } | { mode: "aggregate" };

type AnalyticsRuntimeConfig = {
	analytics: Pick<LibraryServerConfig["analytics"], "consentPolicyVersion">;
	identity: Pick<LibraryServerConfig["identity"], "baseUrl">;
};

function validDistinctId(value: string | null | undefined) {
	const normalized = value?.trim();
	return normalized && normalized.length <= 200 ? normalized : null;
}

export function getServerAnalyticsContext(
	config: AnalyticsRuntimeConfig,
	request: Request,
	requestedDistinctId?: string,
): ServerAnalyticsContext {
	const consent = readAnalyticsConsentCookieHeader(
		request.headers.get("cookie"),
		analyticsConsentPolicy(config),
	);
	const distinctId = validDistinctId(requestedDistinctId);

	if (analyticsConsentState(consent) === "granted" && distinctId) {
		return { mode: "consented", distinctId };
	}

	return { mode: "aggregate" };
}

function aggregateDistinctId(config: AnalyticsRuntimeConfig) {
	const scope = createHash("sha256")
		.update(config.identity.baseUrl)
		.digest("hex")
		.slice(0, 16);
	const day = new Date().toISOString().slice(0, 10);
	return `aggregate:${scope}:${day}`;
}

export async function captureServerAnalyticsEvent(
	config: Pick<
		LibraryServerConfig,
		"analytics" | "identity" | "revision" | "updatedAt"
	>,
	{
		event,
		context,
		properties,
	}: {
		event: string;
		context: ServerAnalyticsContext;
		properties: Record<string, unknown>;
	},
) {
	try {
		const posthog = await getPostHogForConfig(config);
		if (!posthog) return;

		posthog.capture({
			event,
			distinctId:
				context.mode === "consented"
					? context.distinctId
					: aggregateDistinctId(config),
			disableGeoip: true,
			properties: {
				...properties,
				// Which community sent it, as its browser events say too (analytics.ts).
				environment: new URL(config.identity.baseUrl).host,
				analytics_mode: context.mode,
				...(context.mode === "aggregate"
					? { $process_person_profile: false }
					: {}),
			},
		});
	} catch (error) {
		console.error("Failed to record server analytics event", {
			event,
			error,
		});
	}
}
