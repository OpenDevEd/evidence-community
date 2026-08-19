import { describe, expect, it } from "vitest";

import {
	adminCanonicalPayloadToItemFields,
	isPublicTopLevelItem,
	isTopLevelAdminItemType,
} from "@/lib/admin/item-fields";
import { humanizeAdminField } from "@/components/admin/admin-schema";

describe("admin item fields", () => {
	it("never treats attachments, notes or annotations as records of their own", () => {
		expect(isTopLevelAdminItemType("attachment")).toBe(false);
		expect(isTopLevelAdminItemType("Attachment")).toBe(false);
		expect(isTopLevelAdminItemType("Annotation")).toBe(false);
		expect(isTopLevelAdminItemType("note")).toBe(false);
		expect(isTopLevelAdminItemType("report")).toBe(true);
	});

	it("keeps parentless attachments, notes and annotations out of the public library", () => {
		expect(isPublicTopLevelItem({ itemType: "Attachment", parentItem: null })).toBe(false);
		expect(isPublicTopLevelItem({ itemType: "attachment", parentItem: "ABCD2345" })).toBe(false);
		expect(isPublicTopLevelItem({ itemType: "Note", parentItem: null })).toBe(false);
		expect(isPublicTopLevelItem({ itemType: "Annotation", parentItem: null })).toBe(false);
		expect(isPublicTopLevelItem({ itemType: "Book", parentItem: null })).toBe(true);
		expect(isPublicTopLevelItem({ itemType: "Book", parentItem: "ABCD2345" })).toBe(false);
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
