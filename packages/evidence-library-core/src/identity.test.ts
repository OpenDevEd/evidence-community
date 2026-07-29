import { describe, expect, it } from "vitest";

import {
	adoptableCanonicalRecordKey,
	CANONICAL_RECORD_KEY_PATTERN,
	generateCanonicalRecordKey,
	isCanonicalRecordKey,
	isSourceConnectionKey,
} from "./identity.js";

describe("canonical record keys", () => {
	it("accepts the exact Zotero object-key alphabet and length", () => {
		expect(isCanonicalRecordKey("23456789")).toBe(true);
		expect(isCanonicalRecordKey("ABCDEFGHI")).toBe(false);
		expect(isCanonicalRecordKey("ABCD0EFG")).toBe(false);
		expect(isCanonicalRecordKey("ABCDOEFG")).toBe(false);
	});

	it("adopts compatible provider keys without rewriting them", () => {
		expect(adoptableCanonicalRecordKey("ABCD2345")).toBe("ABCD2345");
		expect(adoptableCanonicalRecordKey("https://openalex.org/W123")).toBeNull();
	});

	it("generates canonical keys without modulo bias leaking invalid symbols", () => {
		for (let index = 0; index < 1_000; index += 1) {
			expect(generateCanonicalRecordKey()).toMatch(
				CANONICAL_RECORD_KEY_PATTERN,
			);
		}
	});
});

describe("source connection keys", () => {
	it("accepts human-readable immutable slugs", () => {
		expect(isSourceConnectionKey("native")).toBe(true);
		expect(isSourceConnectionKey("zotero-ekitabu")).toBe(true);
		expect(isSourceConnectionKey(`z${"a".repeat(63)}`)).toBe(true);
		expect(isSourceConnectionKey(`z${"a".repeat(64)}`)).toBe(false);
		expect(isSourceConnectionKey("Zotero Ekitabu")).toBe(false);
		expect(isSourceConnectionKey("zotero_ekitabu")).toBe(false);
	});
});
