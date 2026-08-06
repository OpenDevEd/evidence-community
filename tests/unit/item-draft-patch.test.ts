import { describe, expect, it } from "vitest";

import {
	applyItemDraftPatch,
	createItemDraftPatch,
	effectiveItemParent,
} from "@/lib/admin/item-draft-merge";

describe("item draft patches", () => {
	it("stores only fields that differ from the canonical base", () => {
		expect(
			createItemDraftPatch(
				{
					collections: ["ABCD2345"],
					itemType: "Report",
					tags: ["published"],
					title: "Published title",
				},
				{
					collections: ["ABCD2345"],
					itemType: "Report",
					tags: ["draft"],
					title: "Edited title",
				},
			),
		).toEqual({ tags: ["draft"], title: "Edited title" });
	});

	it("uses explicit null tombstones for removed fields", () => {
		const patch = createItemDraftPatch(
			{ abstractNote: "Published abstract", itemType: "Report" },
			{ itemType: "Report" },
		);
		expect(patch).toEqual({ abstractNote: null });
		expect(
			applyItemDraftPatch(
				{ abstractNote: "New remote abstract", itemType: "Report" },
				patch,
			),
		).toEqual({ itemType: "Report" });
	});

	it("overlays a patch onto a newer canonical base", () => {
		expect(
			applyItemDraftPatch(
				{
					date: "2026",
					itemType: "Report",
					title: "New remote title",
				},
				{ title: "Local draft title" },
			),
		).toEqual({
			date: "2026",
			itemType: "Report",
			title: "Local draft title",
		});
	});

	it("removes a patch field when the editor restores the base value", () => {
		expect(
			createItemDraftPatch(
				{ itemType: "Report", title: "Published title" },
				{ itemType: "Report", title: "Published title" },
			),
		).toEqual({});
	});

	it("does not treat JSON object key order as an edit", () => {
		expect(
			createItemDraftPatch(
				{
					creators: [
						{
							lastName: "Lovelace",
							firstName: "Ada",
							creatorType: "author",
						},
					],
				},
				{
					creators: [
						{
							creatorType: "author",
							firstName: "Ada",
							lastName: "Lovelace",
						},
					],
				},
			),
		).toEqual({});
	});

	it("rebases only editor changes onto a remotely updated draft", () => {
		const editorChanges = createItemDraftPatch(
			{ date: "2024", itemType: "Report", title: "Original title" },
			{ date: "2024", itemType: "Report", title: "Local title" },
		);
		expect(
			applyItemDraftPatch(
				{ date: "2026", itemType: "Report", title: "Remote title" },
				editorChanges,
			),
		).toEqual({
			date: "2026",
			itemType: "Report",
			title: "Local title",
		});
	});

	it("distinguishes an inherited parent from a cleared or changed parent", () => {
		expect(effectiveItemParent("PARENT23", {})).toBe("PARENT23");
		expect(
			effectiveItemParent("PARENT23", { parentItem: null }),
		).toBeNull();
		expect(
			effectiveItemParent("PARENT23", { parentItem: "PARENT45" }),
		).toBe("PARENT45");
	});
});
