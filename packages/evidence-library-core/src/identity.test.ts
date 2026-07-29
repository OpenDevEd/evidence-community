import { describe, expect, it } from "vitest";

import {
	adoptableCanonicalRecordKey,
	CANONICAL_RECORD_KEY_PATTERN,
	generateCanonicalRecordKey,
	isCanonicalRecordKey,
	isSourceConnectionKey,
	reserveCanonicalRecordKey,
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

describe("canonical key reservations", () => {
	it("adopts a compatible source key before generating one", async () => {
		const reservations: string[] = [];
		const key = await reserveCanonicalRecordKey({
			sourceRecordKey: "ABCD2345",
			findExistingKey: async () => null,
			tryReserveKey: async (candidate) => {
				reservations.push(candidate);
				return true;
			},
			generateKey: () => "ZZZZZZZZ",
		});

		expect(key).toBe("ABCD2345");
		expect(reservations).toEqual(["ABCD2345"]);
	});

	it("recovers the winner of a concurrent source reservation", async () => {
		let existing: string | null = null;
		const key = await reserveCanonicalRecordKey({
			sourceRecordKey: "ABCD2345",
			findExistingKey: async () => existing,
			tryReserveKey: async () => {
				existing = "WXYZ2345";
				return false;
			},
		});

		expect(key).toBe("WXYZ2345");
	});

	it("mints after an adopted key collides with another source", async () => {
		const attempted: string[] = [];
		const key = await reserveCanonicalRecordKey({
			sourceRecordKey: "ABCD2345",
			findExistingKey: async () => null,
			tryReserveKey: async (candidate) => {
				attempted.push(candidate);
				return candidate === "WXYZ2345";
			},
			generateKey: () => "WXYZ2345",
		});

		expect(key).toBe("WXYZ2345");
		expect(attempted).toEqual(["ABCD2345", "WXYZ2345"]);
	});
});
