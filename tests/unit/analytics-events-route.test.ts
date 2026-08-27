import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
	capture: vi.fn(),
	config: {
		analytics: { consentPolicyVersion: 1 },
		identity: { baseUrl: "https://library.example.org" },
	},
}));

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: vi.fn(async () => harness.config),
}));
vi.mock("@/lib/server-analytics", () => ({
	captureServerAnalyticsEvent: harness.capture,
}));

import { POST } from "@/app/api/analytics/events/route";
import {
	ANALYTICS_CONSENT_COOKIE_NAME,
	createAnalyticsConsentRecord,
	serializeAnalyticsConsentRecord,
} from "@/lib/analytics-consent";

function request(
	analytics: boolean | null,
	body: unknown,
	secFetchSite = "same-origin",
) {
	const record =
		analytics === null
			? null
			: createAnalyticsConsentRecord(
					{ scope: harness.config.identity.baseUrl, version: 1 },
					{ analytics, sessionReplay: false },
				);
	return new Request("https://library.example.org/api/analytics/events", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"sec-fetch-site": secFetchSite,
			...(record
				? {
						cookie: `${ANALYTICS_CONSENT_COOKIE_NAME}=${serializeAnalyticsConsentRecord(record)}`,
					}
				: {}),
		},
		body: JSON.stringify(body),
	});
}

describe("rejected analytics route", () => {
	beforeEach(() => harness.capture.mockReset());

	it("accepts one strict, content-free aggregate event after rejection", async () => {
		const response = await POST(
			request(false, {
				event: "page_view",
				properties: { pagePath: "/lib?query=private#result" },
			}),
		);

		expect(response.status).toBe(202);
		expect(harness.capture).toHaveBeenCalledWith(harness.config, {
			event: "page_view",
			context: { mode: "aggregate" },
			properties: { page_path: "/lib" },
		});
	});

	it("does nothing while consent is pending or granted", async () => {
		for (const consent of [null, true] as const) {
			const response = await POST(
				request(consent, {
					event: "page_view",
					properties: { pagePath: "/lib" },
				}),
			);
			expect(response.status).toBe(204);
		}
		expect(harness.capture).not.toHaveBeenCalled();
	});

	it("rejects cross-site, malformed, and content-bearing requests", async () => {
		expect((await POST(request(false, {}, "cross-site"))).status).toBe(403);
		expect(
			(
				await POST(
					request(false, {
						event: "page_view",
						properties: { pagePath: "/lib", query: "private" },
					}),
				)
			).status,
		).toBe(400);
		expect(harness.capture).not.toHaveBeenCalled();
	});
});
