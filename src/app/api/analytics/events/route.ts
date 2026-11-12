import { getLibraryConfig } from "@/config/library-config/server";
import {
	analyticsConsentPolicy,
	analyticsConsentState,
	readAnalyticsConsentCookieHeader,
} from "@/lib/analytics-consent";
import {
	aggregateAnalyticsEventSchema,
	normalizeAggregateAnalyticsProperties,
} from "@/lib/analytics-event-schema";
import { captureServerAnalyticsEvent } from "@/lib/server-analytics";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
	const fetchSite = request.headers.get("sec-fetch-site");
	if (
		fetchSite &&
		!["same-origin", "same-site", "none"].includes(fetchSite)
	) {
		return NextResponse.json(
			{ error: "Cross-site request rejected" },
			{ status: 403 },
		);
	}

	const config = await getLibraryConfig();
	const consent = readAnalyticsConsentCookieHeader(
		request.headers.get("cookie"),
		analyticsConsentPolicy(config),
	);
	if (analyticsConsentState(consent) !== "denied") {
		return new NextResponse(null, { status: 204 });
	}

	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return NextResponse.json(
			{ error: "Invalid analytics event" },
			{ status: 400 },
		);
	}

	const parsed = aggregateAnalyticsEventSchema.safeParse(payload);
	if (!parsed.success) {
		return NextResponse.json(
			{ error: "Invalid analytics event" },
			{ status: 400 },
		);
	}

	await captureServerAnalyticsEvent(config, {
		event: parsed.data.event,
		context: { mode: "aggregate" },
		properties: normalizeAggregateAnalyticsProperties(parsed.data),
	});

	return new NextResponse(null, { status: 202 });
}
