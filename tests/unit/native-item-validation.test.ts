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
			if (definition.itemType === "note") {
				payload.note = "Example note";
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
