import { describe, expect, it } from "vitest";

vi.mock("server-only", () => ({}));

import {
	ANALYTICS_CONSENT_COOKIE_NAME,
	createAnalyticsConsentRecord,
	serializeAnalyticsConsentRecord,
} from "@/lib/analytics-consent";
import { getServerAnalyticsContext } from "@/lib/server-analytics";
import { vi } from "vitest";

const config = {
	analytics: {
		consentPolicyVersion: 2,
	},
	identity: {
		baseUrl: "https://library.example.org",
	},
};

function requestWithConsent(analytics: boolean) {
	const record = createAnalyticsConsentRecord(
		{ scope: config.identity.baseUrl, version: 2 },
		{ analytics, sessionReplay: false },
	);
	return new Request("https://library.example.org/api/ai", {
		headers: {
			cookie: `${ANALYTICS_CONSENT_COOKIE_NAME}=${serializeAnalyticsConsentRecord(record)}`,
		},
	});
}

describe("server analytics consent", () => {
	it("links an event only when scoped consent and a client ID are both present", () => {
		expect(
			getServerAnalyticsContext(
				config,
				requestWithConsent(true),
				"browser-id",
			),
		).toEqual({ mode: "consented", distinctId: "browser-id" });
		expect(
			getServerAnalyticsContext(config, requestWithConsent(true)),
		).toEqual({ mode: "aggregate" });
	});

	it("does not let a request-body ID override rejected, missing, or wrong-tenant consent", () => {
		expect(
			getServerAnalyticsContext(
				config,
				requestWithConsent(false),
				"spoofed-id",
			),
		).toEqual({ mode: "aggregate" });
		expect(
			getServerAnalyticsContext(
				config,
				new Request("https://library.example.org/api/ai"),
				"spoofed-id",
			),
		).toEqual({ mode: "aggregate" });
		expect(
			getServerAnalyticsContext(
				{
					...config,
					identity: { baseUrl: "https://other.example.org" },
				},
				requestWithConsent(true),
				"spoofed-id",
			),
		).toEqual({ mode: "aggregate" });
	});

	it("rejects blank and oversized client IDs", () => {
		expect(
			getServerAnalyticsContext(config, requestWithConsent(true), " "),
		).toEqual({ mode: "aggregate" });
		expect(
			getServerAnalyticsContext(
				config,
				requestWithConsent(true),
				"x".repeat(201),
			),
		).toEqual({ mode: "aggregate" });
	});
});
