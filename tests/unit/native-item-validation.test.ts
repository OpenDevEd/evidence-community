import { getZoteroSchema } from "@opendeved/evidence-library-core/zotero-schema";
import { describe, expect, it } from "vitest";

import { validateNativeItemDraft } from "@/lib/admin/native-item-validation";

describe("native item draft validation", () => {
	it("can validate source attachment metadata before its parent reference is resolved", () => {
		expect(
			validateNativeItemDraft(
				{ itemType: "Attachment", title: "Imported PDF" },
				{ requireAttachmentParent: false },
			).item,
		).toMatchObject({ itemType: "Attachment" });
	});

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
						creatorType: definition.creatorTypes[0].creatorType,
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
			if (definition.itemType === "attachment") {
				payload.parentItem = "ABCD2345";
			}
			if (definition.itemType === "annotation") {
				Object.assign(payload, {
					parentItem: "ABCD2345",
					annotationType: "highlight",
					annotationAuthorName: "Ada",
					annotationText: "Evidence",
					annotationComment: "Important",
					annotationColor: "#ffd400",
					annotationPageLabel: "4",
					annotationSortIndex: "00004|000001|00000",
					annotationPosition: '{"pageIndex":3,"rects":[[1,2,3,4]]}',
				});
			}

			const validated = validateNativeItemDraft(payload);
			expect(validated.item.itemType.toLowerCase()).toBe(
				definition.itemType.toLowerCase(),
			);
		}
	});

	it("requires valid child metadata before publication", () => {
		for (const payload of [
			{ itemType: "Attachment" },
			{ itemType: "Annotation" },
			{
				itemType: "Annotation",
				parentItem: "ABCD2345",
				annotationType: "unknown",
				annotationPosition: "not json",
			},
		]) {
			expect(() => validateNativeItemDraft(payload)).toThrow();
		}

		expect(() =>
			validateNativeItemDraft({
				itemType: "Annotation",
				parentItem: "ABCD2345",
				annotationType: "highlight",
				annotationPosition: '{"pageIndex":0,"rects":[]}',
			}),
		).not.toThrow();
	});

	it("returns field errors for fields and creator roles that do not belong to the item type", () => {
		try {
			validateNativeItemDraft({
				itemType: "book",
				reportNumber: "not a book field",
			});
			expect.unreachable("Expected field validation to fail");
		} catch (error) {
			expect(error).toMatchObject({
				fields: {
					reportNumber: "Report Number is not available for Book.",
				},
			});
		}

		try {
			validateNativeItemDraft({
				itemType: "book",
				creators: [
					{
						creatorType: "director",
						name: "Wrong Role",
					},
				],
			});
			expect.unreachable("Expected creator role validation to fail");
		} catch (error) {
			expect(error).toMatchObject({
				fields: {
					"creators.0.creatorType":
						"This creator role is not available for the selected item type.",
				},
			});
		}
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
			tags: ["education", "evidence"],
			collections: ["ABCD2345"],
		});
	});

	it("returns field errors for malformed names and collection keys", () => {
		try {
			validateNativeItemDraft({
				itemType: "book",
				creators: [
					{
						creatorType: "author",
						firstName: "Ada",
						name: "Ada Lovelace",
					},
				],
			});
			expect.unreachable("Expected creator name validation to fail");
		} catch (error) {
			expect(error).toMatchObject({
				fields: {
					"creators.0":
						"Use either a person name or an organisation name, not both.",
				},
			});
		}

		try {
			validateNativeItemDraft({
				itemType: "book",
				collections: ["--------"],
			});
			expect.unreachable("Expected collection validation to fail");
		} catch (error) {
			expect(error).toMatchObject({
				fields: {
					collections:
						"One or more selected collections are invalid.",
				},
			});
		}
	});

	it("allows incomplete creators only while saving a draft", () => {
		const payload = {
			itemType: "book",
			creators: [
				{
					creatorType: "author",
					firstName: "",
					lastName: "",
				},
			],
		};

		try {
			validateNativeItemDraft(payload);
			expect.unreachable(
				"Expected incomplete creator validation to fail",
			);
		} catch (error) {
			expect(error).toMatchObject({
				fields: {
					"creators.0":
						"Enter a name for this creator, or remove the empty creator.",
				},
			});
		}
		expect(
			validateNativeItemDraft(payload, {
				allowIncompleteCreators: true,
			}).payload,
		).toMatchObject({
			...payload,
			itemType: "Book",
		});
	});
});
