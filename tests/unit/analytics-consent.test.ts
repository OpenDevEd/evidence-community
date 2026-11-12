import { describe, expect, it } from "vitest";

import {
	ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS,
	ANALYTICS_CONSENT_COOKIE_NAME,
	analyticsConsentCookie,
	analyticsConsentState,
	asksAnalyticsConsent,
	createAnalyticsConsentRecord,
	normalizeAnalyticsConsentScope,
	parseAnalyticsConsentRecord,
	readAnalyticsConsentCookieHeader,
	serializeAnalyticsConsentRecord,
} from "@/lib/analytics-consent";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { minimalLibraryConfig } from "../fixtures/library-config";
const runtimeConfig = libraryConfigSchema.parse(minimalLibraryConfig);

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

	it("requires renewed consent after the built-in collection policy changes", () => {
		const record = createAnalyticsConsentRecord(policy, { analytics: true, sessionReplay: true }, now);
		const { runtimePolicyVersion: _version, ...previousRecord } = record;
		for (const previous of [previousRecord, { ...record, runtimePolicyVersion: 1 }]) {
			expect(parseAnalyticsConsentRecord(encodeURIComponent(JSON.stringify(previous)), policy, now)).toBeNull();
		}
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

// The cookie and its format are Openscholar's (openalex-count `lib/consent-cookie.ts`): its banner and every community
// on openscholar.ai read and write the same answer.
describe("one answer across openscholar.ai", () => {
	const community = { scope: "https://aied.openscholar.ai", version: 3 };
	const fromOpenscholar = (choice: string) =>
		encodeURIComponent(JSON.stringify({ choice, timestamp: "2026-11-12T10:00:00.000Z", policyVersion: "1.0" }));

	it("takes the answer given on Openscholar, replay included", () => {
		expect(
			readAnalyticsConsentCookieHeader(`NEXT_LOCALE=en; openscholar_consent=${fromOpenscholar("granted")}`, community, now)
				?.preferences,
		).toEqual({ analytics: true, sessionReplay: true });
		expect(
			analyticsConsentState(readAnalyticsConsentCookieHeader(`openscholar_consent=${fromOpenscholar("denied")}`, community, now)),
		).toBe("denied");
		expect(readAnalyticsConsentCookieHeader(`openscholar_consent=${fromOpenscholar("maybe")}`, community, now)).toBeNull();
	});

	it("ignores a community's own earlier answer there", () => {
		const own = serializeAnalyticsConsentRecord(createAnalyticsConsentRecord(community, { analytics: true, sessionReplay: true }, now));
		expect(readAnalyticsConsentCookieHeader(`${ANALYTICS_CONSENT_COOKIE_NAME}=${own}`, community, now)).toBeNull();
	});

	it("writes the answer where Openscholar reads it", () => {
		const cookie = analyticsConsentCookie(community, { analytics: true, sessionReplay: false }, { now, secure: true });
		const [pair, ...attributes] = cookie.split("; ");
		const [name, value] = pair.split("=");
		expect(name).toBe("openscholar_consent");
		expect(JSON.parse(decodeURIComponent(value))).toEqual({
			choice: "granted",
			timestamp: new Date(now).toISOString(),
			policyVersion: "1.0",
		});
		expect(attributes).toEqual(expect.arrayContaining(["Domain=openscholar.ai", "Path=/", "Secure"]));
		expect(analyticsConsentCookie(community, { analytics: false, sessionReplay: false }, { now, secure: true })).toContain(
			encodeURIComponent('"choice":"denied"'),
		);
	});

	it("keeps a community on its own domain to itself", () => {
		expect(readAnalyticsConsentCookieHeader(`openscholar_consent=${fromOpenscholar("granted")}`, policy, now)).toBeNull();
		const cookie = analyticsConsentCookie(policy, { analytics: true, sessionReplay: false }, { now, secure: true });
		expect(cookie.startsWith(`${ANALYTICS_CONSENT_COOKIE_NAME}=`)).toBe(true);
		expect(cookie).not.toContain("Domain=");
		expect(readAnalyticsConsentCookieHeader(cookie.split("; ")[0], policy, now)?.preferences).toEqual({
			analytics: true,
			sessionReplay: false,
		});
		expect(
			readAnalyticsConsentCookieHeader(
				`openscholar_consent=${fromOpenscholar("granted")}`,
				{ scope: "https://openscholar.ai.example.org", version: 3 },
				now,
			),
		).toBeNull();
	});
});

describe("where the cookie question is asked", () => {
	it("asks on the library pages", () => {
		expect(asksAnalyticsConsent("/en-GB/lib", "en-GB", runtimeConfig)).toBe(true);
		expect(asksAnalyticsConsent("/en-GB", "en-GB", runtimeConfig)).toBe(true);
		expect(asksAnalyticsConsent("/en-GB/map/", "en-GB", runtimeConfig)).toBe(true);
	});

	it("never asks in the admin area, which has no dialog to answer", () => {
		expect(asksAnalyticsConsent("/en-GB/admin", "en-GB", runtimeConfig)).toBe(false);
		expect(asksAnalyticsConsent("/en-GB/admin/items", "en-GB", runtimeConfig)).toBe(false);
		expect(asksAnalyticsConsent("/admin", "en-GB", runtimeConfig)).toBe(false);
	});

	it("never asks on the pages that explain the cookies", () => {
		expect(asksAnalyticsConsent("/en-GB/privacy", "en-GB", runtimeConfig)).toBe(false);
		expect(asksAnalyticsConsent("/en-GB/cookie-policy/", "en-GB", runtimeConfig)).toBe(false);
	});
});


describe("configured policy pages stay readable before consent", () => {
	const config = { ...runtimeConfig, identity: { ...runtimeConfig.identity, baseUrl: "https://library.example.org" }, legal: {
		privacyPolicy: "/privacy", cookiePolicy: "/terms", termsOfService: "/terms",
	} };
	it.each(["/en-GB/terms", "/ar/terms/"])("does not gate %s", (path) => {
		expect(asksAnalyticsConsent(path, "en-GB", config)).toBe(false);
	});
	it("allows a configured local destination without exempting an external lookalike", () => {
		expect(asksAnalyticsConsent("/fr/contact", "fr", { ...config, legal: { ...config.legal, cookiePolicy: "/en-GB/contact?policy=1#cookies" } })).toBe(false);
		expect(asksAnalyticsConsent("/fr/contact", "fr", { ...config, legal: { ...config.legal, cookiePolicy: "https://external.example.org/contact" } })).toBe(true);
	});
});
