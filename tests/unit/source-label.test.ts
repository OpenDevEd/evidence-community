import { describe, expect, it } from "vitest";

import { sourceDisplayLabel } from "@/lib/admin/source-label";

describe("sourceDisplayLabel", () => {
	it("keeps same-name source choices distinct across scopes and providers", () => {
		const labels = [
			{ provider: "zotero", externalScopeKey: "123" },
			{ provider: "zotero", externalScopeKey: "456" },
			{ provider: "mendeley", externalScopeKey: "123" },
		].map((source) => sourceDisplayLabel({
			...source,
			displayName: "Research",
			key: `${source.provider}-${source.externalScopeKey}`,
		}, { includeIdentifier: true }));
		expect(new Set(labels).size).toBe(3);
	});

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
		const openAlex = { externalScopeKey: null, key: "openalex-14ce8dae", provider: "openalex" };
		expect(sourceDisplayLabel({ ...openAlex, displayName: null })).toBe("OpenAlex");
		expect(sourceDisplayLabel({ ...openAlex, displayName: "Tusome literacy" }, { includeIdentifier: true })).toBe("Tusome literacy (OpenAlex)");
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
