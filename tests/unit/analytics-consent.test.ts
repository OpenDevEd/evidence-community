import { describe, expect, it } from "vitest";

import {
	ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS,
	ANALYTICS_CONSENT_COOKIE_NAME,
	analyticsConsentState,
	asksAnalyticsConsent,
	createAnalyticsConsentRecord,
	normalizeAnalyticsConsentScope,
	parseAnalyticsConsentRecord,
	readAnalyticsConsentCookieHeader,
	serializeAnalyticsConsentRecord,
} from "@/lib/analytics-consent";

const now = 1_777_777_777_777;
const policy = {
	scope: "https://library.example.org",
	version: 3,
};

describe("analytics consent records", () => {
	it("round-trips consent for the matching tenant and policy", () => {
		const record = createAnalyticsConsentRecord(
			policy,
			{ analytics: true, sessionReplay: false },
			now,
		);

		expect(
			parseAnalyticsConsentRecord(
				serializeAnalyticsConsentRecord(record),
				policy,
				now,
			),
		).toEqual(record);
		expect(analyticsConsentState(record)).toBe("granted");
	});

	it("rejects old, malformed, expired, future, wrong-tenant, and wrong-policy values", () => {
		const record = createAnalyticsConsentRecord(
			policy,
			{ analytics: true, sessionReplay: false },
			now,
		);
		const serialized = serializeAnalyticsConsentRecord(record);

		expect(parseAnalyticsConsentRecord("granted", policy, now)).toBeNull();
		expect(parseAnalyticsConsentRecord("denied", policy, now)).toBeNull();
		expect(parseAnalyticsConsentRecord("%7Bbroken", policy, now)).toBeNull();
		expect(
			parseAnalyticsConsentRecord(serialized, { ...policy, version: 4 }, now),
		).toBeNull();
		expect(
			parseAnalyticsConsentRecord(
				serialized,
				{ ...policy, scope: "https://other.example.org" },
				now,
			),
		).toBeNull();
		expect(
			parseAnalyticsConsentRecord(
				serialized,
				policy,
				now + ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS * 1_000 + 1,
			),
		).toBeNull();

		const future = createAnalyticsConsentRecord(
			policy,
			{ analytics: true, sessionReplay: false },
			now + 1,
		);
		expect(
			parseAnalyticsConsentRecord(
				serializeAnalyticsConsentRecord(future),
				policy,
				now,
			),
		).toBeNull();
		expect(analyticsConsentState(null)).toBe("pending");
	});

	it("normalizes the configured base URL as a stable tenant scope", () => {
		expect(
			normalizeAnalyticsConsentScope("https://Library.Example.org/path?q=1#x"),
		).toBe("https://library.example.org");
	});

	it("cannot enable replay without product analytics", () => {
		const record = createAnalyticsConsentRecord(
			policy,
			{ analytics: false, sessionReplay: true },
			now,
		);

		expect(record.preferences).toEqual({
			analytics: false,
			sessionReplay: false,
		});
		expect(analyticsConsentState(record)).toBe("denied");
	});

	it("reads only a matching record from a cookie header", () => {
		const record = createAnalyticsConsentRecord(
			policy,
			{ analytics: true, sessionReplay: true },
			now,
		);
		const header = `NEXT_LOCALE=en; ${ANALYTICS_CONSENT_COOKIE_NAME}=${serializeAnalyticsConsentRecord(record)}; other=value`;

		expect(readAnalyticsConsentCookieHeader(header, policy, now)).toEqual(record);
		expect(
			readAnalyticsConsentCookieHeader(
				header,
				{ ...policy, scope: "https://other.example.org" },
				now,
			),
		).toBeNull();
	});
});

describe("where the cookie question is asked", () => {
	it("asks on the library pages", () => {
		expect(asksAnalyticsConsent("/en-GB/lib", "en-GB")).toBe(true);
		expect(asksAnalyticsConsent("/en-GB", "en-GB")).toBe(true);
		expect(asksAnalyticsConsent("/en-GB/map/", "en-GB")).toBe(true);
	});

	it("never asks in the admin area, which has no dialog to answer", () => {
		expect(asksAnalyticsConsent("/en-GB/admin", "en-GB")).toBe(false);
		expect(asksAnalyticsConsent("/en-GB/admin/items", "en-GB")).toBe(false);
		expect(asksAnalyticsConsent("/admin", "en-GB")).toBe(false);
	});

	it("never asks on the pages that explain the cookies", () => {
		expect(asksAnalyticsConsent("/en-GB/privacy", "en-GB")).toBe(false);
		expect(asksAnalyticsConsent("/en-GB/cookie-policy/", "en-GB")).toBe(false);
	});
});
