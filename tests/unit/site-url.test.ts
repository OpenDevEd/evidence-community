import { describe, expect, it } from "vitest";

import { buildSiteUrl, normalizeSiteOrigin } from "@/lib/site-url";

describe("site URL behavior", () => {
	it.each([
		["example.com", "https://example.com"],
		[" https://example.com/path ", "https://example.com"],
		["http://localhost:3000", "http://localhost:3000"],
		["", null],
		["not a URL", null],
	])("normalizes %j to %j", (input, expected) => {
		expect(normalizeSiteOrigin(input)).toBe(expected);
	});

	it("builds absolute URLs from the configured origin", () => {
		expect(buildSiteUrl("/privacy", "https://example.com")).toBe(
			"https://example.com/privacy",
		);
	});
});
