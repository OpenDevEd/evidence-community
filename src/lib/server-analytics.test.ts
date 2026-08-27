import assert from "node:assert/strict";
import test from "node:test";
import {
	ANALYTICS_CONSENT_COOKIE_NAME,
	createAnalyticsConsentRecord,
	serializeAnalyticsConsentRecord,
} from "./analytics-consent";
import { getServerAnalyticsContext } from "./server-analytics";

function requestWithConsent(analytics: boolean) {
	const record = createAnalyticsConsentRecord({
		analytics,
		sessionReplay: false,
	});
	return new Request("https://example.test/api/ai", {
		headers: {
			cookie: `${ANALYTICS_CONSENT_COOKIE_NAME}=${serializeAnalyticsConsentRecord(record)}`,
		},
	});
}

test("links server telemetry only when consent and a client ID are both present", () => {
	assert.deepEqual(
		getServerAnalyticsContext(requestWithConsent(true), "browser-id"),
		{ mode: "consented", distinctId: "browser-id" },
	);
	assert.deepEqual(
		getServerAnalyticsContext(requestWithConsent(true), undefined),
		{ mode: "aggregate" },
	);
});

test("a request-body ID cannot override rejected or missing consent", () => {
	assert.deepEqual(
		getServerAnalyticsContext(requestWithConsent(false), "spoofed-id"),
		{ mode: "aggregate" },
	);
	assert.deepEqual(
		getServerAnalyticsContext(
			new Request("https://example.test/api/ai"),
			"spoofed-id",
		),
		{ mode: "aggregate" },
	);
});
