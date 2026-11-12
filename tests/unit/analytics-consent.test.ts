import { describe, expect, it } from "vitest";

import {
	ANALYTICS_CONSENT_COOKIE_MAX_AGE_SECONDS,
	ANALYTICS_CONSENT_COOKIE_NAME,
	analyticsConsentCookies,
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

	it("keeps an answer given on the community before, until a shared one exists", () => {
		const own = `${ANALYTICS_CONSENT_COOKIE_NAME}=${serializeAnalyticsConsentRecord(
			createAnalyticsConsentRecord(community, { analytics: true, sessionReplay: false }, now),
		)}`;
		expect(readAnalyticsConsentCookieHeader(own, community, now)?.preferences).toEqual({ analytics: true, sessionReplay: false });
		expect(
			readAnalyticsConsentCookieHeader(`${own}; openscholar_consent=${fromOpenscholar("denied")}`, community, now)?.preferences,
		).toEqual({ analytics: false, sessionReplay: false });
		// Given for that community alone, so another community doesn't take it.
		expect(readAnalyticsConsentCookieHeader(own, { scope: "https://tvet.openscholar.ai", version: 3 }, now)).toBeNull();
	});

	it("clears that earlier answer once the shared one is saved", () => {
		const lines = analyticsConsentCookies(community, { analytics: true, sessionReplay: true }, { now, secure: true });
		expect(lines.map((line) => line.split("=")[0])).toEqual(["openscholar_consent", ANALYTICS_CONSENT_COOKIE_NAME]);
		expect(lines[1]).toContain("Max-Age=0");
		expect(analyticsConsentCookies(policy, { analytics: true, sessionReplay: true }, { now, secure: true })).toHaveLength(1);
	});

	it("writes the answer where Openscholar reads it", () => {
		const cookie = analyticsConsentCookies(community, { analytics: true, sessionReplay: false }, { now, secure: true })[0];
		const [pair, ...attributes] = cookie.split("; ");
		const [name, value] = pair.split("=");
		expect(name).toBe("openscholar_consent");
		expect(JSON.parse(decodeURIComponent(value))).toEqual({
			choice: "granted",
			timestamp: new Date(now).toISOString(),
			policyVersion: "1.0",
		});
		expect(attributes).toEqual(expect.arrayContaining(["Domain=openscholar.ai", "Path=/", "Secure"]));
		expect(analyticsConsentCookies(community, { analytics: false, sessionReplay: false }, { now, secure: true })[0]).toContain(
			encodeURIComponent('"choice":"denied"'),
		);
	});

	it("keeps a community on its own domain to itself", () => {
		expect(readAnalyticsConsentCookieHeader(`openscholar_consent=${fromOpenscholar("granted")}`, policy, now)).toBeNull();
		const cookie = analyticsConsentCookies(policy, { analytics: true, sessionReplay: false }, { now, secure: true })[0];
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
