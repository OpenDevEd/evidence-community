import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAnalyticsPath } from "./analytics-shared";

test("analytics paths never retain query strings or fragments", () => {
	assert.equal(
		sanitizeAnalyticsPath("https://example.test/lib/ABC?email=a%40b.test#page=2"),
		"/lib/ABC",
	);
	assert.equal(sanitizeAnalyticsPath("/search?q=private#result"), "/search");
	assert.equal(sanitizeAnalyticsPath(null), "/");
});
