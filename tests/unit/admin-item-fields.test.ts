import { describe, expect, it } from "vitest";

import {
	adminCanonicalPayloadToItemFields,
	isTopLevelAdminItemType,
} from "@/lib/admin/item-fields";
import { humanizeAdminField } from "@/components/admin/admin-schema";

describe("admin item fields", () => {
	it("keeps child-only Zotero types out of top-level creation and conversion", () => {
		expect(isTopLevelAdminItemType("attachment")).toBe(false);
		expect(isTopLevelAdminItemType("Annotation")).toBe(false);
		expect(isTopLevelAdminItemType("note")).toBe(false);
		expect(isTopLevelAdminItemType("report")).toBe(true);
	});

	it("preserves common metadata acronyms in human-readable labels", () => {
		expect(humanizeAdminField("url")).toBe("URL");
		expect(humanizeAdminField("DOI")).toBe("DOI");
		expect(humanizeAdminField("tvBroadcast")).toBe("TV Broadcast");
	});

	it("presents canonical storage through item-specific editor fields", () => {
		expect(
			adminCanonicalPayloadToItemFields(
				{
					authority: "Supreme Court",
					date: "2024-05",
					itemType: "Case",
					languageName: "en-GB",
					title: "Example v Example",
				},
				"Case",
			),
		).toMatchObject({
			caseName: "Example v Example",
			court: "Supreme Court",
			dateDecided: "2024-05",
			itemType: "Case",
			language: "en-GB",
		});
	});
});
