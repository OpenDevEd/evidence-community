import "server-only";

import {
	analyticsConsentState,
	readAnalyticsConsentCookieHeader,
} from "@/lib/analytics-consent";
import { getPostHogClient } from "@/lib/posthog";
import { getSiteHost } from "@/lib/site-url";

export type ServerAnalyticsContext =
	| { mode: "consented"; distinctId: string }
	| { mode: "aggregate" };

function validDistinctId(value: string | null | undefined) {
	const normalized = value?.trim();
	return normalized && normalized.length <= 200 ? normalized : null;
}

export function getServerAnalyticsContext(
	request: Request,
	requestedDistinctId?: string,
): ServerAnalyticsContext {
	const consent = readAnalyticsConsentCookieHeader(
		request.headers.get("cookie"),
	);
	const distinctId = validDistinctId(requestedDistinctId);

	if (analyticsConsentState(consent) === "granted" && distinctId) {
		return { mode: "consented", distinctId };
	}

	return { mode: "aggregate" };
}

function aggregateDistinctId() {
	const scope = getSiteHost() || "default";
	const day = new Date().toISOString().slice(0, 10);
	return `aggregate:${scope}:${day}`;
}

export function captureServerAnalyticsEvent({
	event,
	context,
	properties,
}: {
	event: string;
	context: ServerAnalyticsContext;
	properties: Record<string, unknown>;
}) {
	try {
		const posthog = getPostHogClient();
		if (!posthog) return;

		posthog.capture({
			event,
			distinctId:
				context.mode === "consented"
					? context.distinctId
					: aggregateDistinctId(),
			disableGeoip: true,
			properties: {
				...properties,
				analytics_mode: context.mode,
				$process_person_profile: false,
			},
		});
	} catch (error) {
		console.error("Failed to record server analytics event", {
			event,
			error,
		});
	}
}
