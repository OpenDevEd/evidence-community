import assert from "node:assert/strict";
import test from "node:test";
import {
	ANALYTICS_CONSENT_COOKIE_NAME,
	analyticsConsentState,
	createAnalyticsConsentRecord,
	parseAnalyticsConsentRecord,
	readAnalyticsConsentCookieHeader,
	serializeAnalyticsConsentRecord,
} from "./analytics-consent";

test("round-trips a versioned consent record", () => {
	const record = createAnalyticsConsentRecord(
		{ analytics: true, sessionReplay: false },
		1_777_777_777_777,
	);
	const parsed = parseAnalyticsConsentRecord(
		serializeAnalyticsConsentRecord(record),
	);

	assert.deepEqual(parsed, record);
	assert.equal(analyticsConsentState(parsed), "granted");
});

test("rejects legacy and malformed consent values", () => {
	assert.equal(parseAnalyticsConsentRecord("granted"), null);
	assert.equal(parseAnalyticsConsentRecord("denied"), null);
	assert.equal(parseAnalyticsConsentRecord("%7Bbroken"), null);
	assert.equal(analyticsConsentState(null), "pending");
});

test("session replay cannot remain enabled without analytics", () => {
	const record = createAnalyticsConsentRecord({
		analytics: false,
		sessionReplay: true,
	});

	assert.deepEqual(record.preferences, {
		analytics: false,
		sessionReplay: false,
	});
	assert.equal(analyticsConsentState(record), "denied");
});

test("reads the consent record from a cookie header", () => {
	const record = createAnalyticsConsentRecord({
		analytics: true,
		sessionReplay: true,
	});
	const header = `NEXT_LOCALE=en; ${ANALYTICS_CONSENT_COOKIE_NAME}=${serializeAnalyticsConsentRecord(record)}; other=value`;

	assert.deepEqual(readAnalyticsConsentCookieHeader(header), record);
});
