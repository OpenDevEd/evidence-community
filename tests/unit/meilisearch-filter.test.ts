import { describe, expect, it } from "vitest";

import {
	meilisearchEquals,
	meilisearchIn,
	meilisearchString,
} from "@/lib/meilisearch-filter";

describe("Meilisearch filters", () => {
	it("quotes names without changing the filter expression", () => {
		expect(meilisearchString('Children\'s "Evidence" \\ Lab')).toBe(
			'"Children\'s \\"Evidence\\" \\\\ Lab"',
		);
		expect(
			meilisearchEquals("institution", 'Children\'s "Evidence" \\ Lab'),
		).toBe('institution = "Children\'s \\"Evidence\\" \\\\ Lab"');
	});

	it("rejects a field name that could change the expression", () => {
		expect(() => meilisearchEquals("institution OR deleted", "x")).toThrow(
			"Invalid Meilisearch filter field",
		);
	});

	it("quotes every value in a list", () => {
		expect(meilisearchIn("key", ['one"two', "three\\four"])).toBe(
			'key IN ["one\\\"two","three\\\\four"]',
		);
	});
});
