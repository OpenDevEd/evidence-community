import { describe, expect, it } from "vitest";

import { isAdminPath, normalizePathname } from "@/lib/path";

describe("path helpers", () => {
	it("normalizes trailing slashes without changing the root path", () => {
		expect(normalizePathname("/lib///")).toBe("/lib");
		expect(normalizePathname("/")).toBe("/");
	});

	it("matches canonical and locale-prefixed admin routes", () => {
		expect(isAdminPath("/admin", "en-GB")).toBe(true);
		expect(isAdminPath("/admin/items", "en-GB")).toBe(true);
		expect(isAdminPath("/fr/admin", "fr")).toBe(true);
		expect(isAdminPath("/fr/admin/", "fr")).toBe(true);
	});

	it("does not hide public chrome for unrelated admin-like segments", () => {
		expect(isAdminPath("/library/admin", "en-GB")).toBe(false);
		expect(isAdminPath("/administrator", "en-GB")).toBe(false);
		expect(isAdminPath("/fr/library/admin", "fr")).toBe(false);
		expect(isAdminPath("/en-GB/admin", "fr")).toBe(false);
	});
});
