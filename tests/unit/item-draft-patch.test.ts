import { describe, expect, it } from "vitest";
import { validateNativeItemDraft } from "@/lib/admin/native-item-validation";
import { createZoteroItemPatch } from "@/lib/source-writeback/zotero/mapper";
import { fullItemWritebackFields } from "@/lib/source-writeback/queue";
import { item } from "@/db/schema/tables/item";

import {
	applyItemDraftPatch,
	createItemDraftPatch,
	effectiveItemParent,
} from "@/lib/admin/item-draft-merge";
import {
	editableItemDatabaseFields,
	publishedAdminItemPayload,
} from "@/lib/admin/item-draft-patch";

describe("item draft patches", () => {
	it("contains only real editable record fields", () => {
		expect(editableItemDatabaseFields).not.toContain("apc_list");
		expect(editableItemDatabaseFields).not.toContain("apc_paid");
	});

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

	it("keeps language edits and full Zotero writeback on the same canonical field", () => {
		const published = publishedAdminItemPayload(
			{ itemType: "Report", key: "ABCD2345", languageName: "English" } as typeof item.$inferSelect,
		);
		const edited = validateNativeItemDraft(applyItemDraftPatch(published, { languageName: "French" }));
		expect(edited.payload.languageName).toBe("French");
		expect(createZoteroItemPatch(published, fullItemWritebackFields()).language).toBe("English");
	});

	it("stores links as one pseudo-field and drops it when reverted", () => {
		const published = publishedAdminItemPayload(
			{ itemType: "Report", key: "ABCD2345", title: "Published" } as never,
			{ links: { cites: ["WXYZ6789"], related: [] } },
		);
		expect(published.links).toEqual({ cites: ["WXYZ6789"], related: [] });
		expect(
			publishedAdminItemPayload(
				{ itemType: "Report", key: "ABCD2345" } as never,
			).links,
		).toBeUndefined();

		const patch = createItemDraftPatch(published, {
			...published,
			links: { cites: ["WXYZ6789", "QRST2345"], related: [] },
		});
		expect(patch).toEqual({
			links: { cites: ["WXYZ6789", "QRST2345"], related: [] },
		});
		expect(
			createItemDraftPatch(published, {
				...published,
				links: { cites: ["WXYZ6789"], related: [] },
			}),
		).toEqual({});
	});
});
