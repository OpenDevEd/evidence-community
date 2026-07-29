import { getZoteroSchema } from "@opendeved/evidence-library-core";
import { describe, expect, it } from "vitest";

import { validateNativeItemDraft } from "@/lib/admin/native-item-validation";

describe("native item draft validation", () => {
	it("accepts every field for every vendored Zotero item type", () => {
		for (const definition of getZoteroSchema().itemTypes) {
			const payload: Record<string, unknown> = {
				itemType: definition.itemType,
			};
			for (const { field } of definition.fields) {
				payload[field] = `${definition.itemType}-${field}`;
			}
			if (definition.creatorTypes[0]) {
				payload.creators = [
					{
						creatorType:
							definition.creatorTypes[0].creatorType,
						name: "Example Creator",
					},
				];
			}
			if (
				definition.itemType === "note" ||
				definition.itemType === "attachment"
			) {
				payload.note = "Example note";
			}
			if (definition.itemType === "annotation") {
				Object.assign(payload, {
					annotationType: "highlight",
					annotationAuthorName: "Ada",
					annotationText: "Evidence",
					annotationComment: "Important",
					annotationColor: "#ffd400",
					annotationPageLabel: "4",
					annotationSortIndex: "00004|000001|00000",
					annotationPosition:
						'{"pageIndex":3,"rects":[[1,2,3,4]]}',
				});
			}

			const validated = validateNativeItemDraft(payload);
			expect(validated.item.itemType.toLowerCase()).toBe(
				definition.itemType.toLowerCase(),
			);
		}
	});

	it("rejects fields and creator types that do not belong to the item type", () => {
		expect(() =>
			validateNativeItemDraft({
				itemType: "book",
				reportNumber: "not a book field",
			}),
		).toThrow("reportNumber is not valid");

		expect(() =>
			validateNativeItemDraft({
				itemType: "book",
				creators: [
					{
						creatorType: "director",
						name: "Wrong Role",
					},
				],
			}),
		).toThrow("director is not valid");
	});

	it("normalizes item types, language, tags, and collections", () => {
		const validated = validateNativeItemDraft({
			itemType: "Book",
			language: "en",
			tags: ["evidence", "education"],
			collections: ["ABCD2345"],
		});

		expect(validated.item).toMatchObject({
			itemType: "Book",
			languageName: "en",
		});
		expect(validated.payload).toMatchObject({
			itemType: "Book",
			language: "en",
			tags: ["evidence", "education"],
			collections: ["ABCD2345"],
		});
	});

	it("rejects malformed names and non-canonical collection keys", () => {
		expect(() =>
			validateNativeItemDraft({
				itemType: "book",
				creators: [
					{
						creatorType: "author",
						firstName: "Ada",
						name: "Ada Lovelace",
					},
				],
			}),
		).toThrow("either name or firstName/lastName");

		expect(() =>
			validateNativeItemDraft({
				itemType: "book",
				collections: ["not-a-key"],
			}),
		).toThrow();
	});
});
