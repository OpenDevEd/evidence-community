import { describe, expect, it } from "vitest";

import { sourceDisplayLabel } from "@/lib/admin/source-label";

describe("sourceDisplayLabel", () => {
	it("prefers the source's own name", () => {
		expect(
			sourceDisplayLabel({
				displayName: "OpenScholar Test 2",
				externalScopeKey: "6642276",
				key: "zotero-test-2",
				provider: "zotero",
			}),
		).toBe("OpenScholar Test 2");
	});

	it("falls back to provider and scope id, and names the library's own records", () => {
		expect(
			sourceDisplayLabel({
				displayName: null,
				externalScopeKey: "6642276",
				key: "zotero-test-2",
				provider: "zotero",
			}),
		).toMatch(/Zotero.*6642276/);
		expect(
			sourceDisplayLabel({
				displayName: "  ",
				externalScopeKey: null,
				key: "mendeley-x",
				provider: "mendeley",
			}),
		).toMatch(/Mendeley.*mendeley-x/);
		expect(
			sourceDisplayLabel({
				displayName: "ignored",
				externalScopeKey: null,
				key: "native",
				provider: "native",
			}),
		).toBe("Native");
	});
});
