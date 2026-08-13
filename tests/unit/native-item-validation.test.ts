import {
	describeZoteroField,
	describeZoteroItemTypeFields,
	getZoteroSchema,
} from "@opendeved/evidence-library-core/zotero-schema";
import { describe, expect, it } from "vitest";

import { adminFieldContract } from "@/lib/admin/field-contract";
import {
	adminCanonicalDraftToItemFields,
	adminCanonicalPayloadToItemFields,
} from "@/lib/admin/item-fields";
import { validateNativeItemDraft } from "@/lib/admin/native-item-validation";

function validFieldValue(field: { baseField?: string; field: string }) {
	const descriptor = describeZoteroField(field);
		switch (adminFieldContract(descriptor).kind) {
		case "access-date":
			return "2024-05-20";
		case "bibliographic-date":
			return "2024";
		case "url":
			return "https://example.com/record";
		default:
			return `Example ${field.field}`;
	}
}

describe("native item draft validation", () => {
	it("stores item-specific Zotero fields under one canonical name", () => {
		expect(
			validateNativeItemDraft({
				itemType: "case",
				caseName: "Example v Example",
				dateDecided: "2024",
				court: "Supreme Court",
			}).item,
		).toMatchObject({
			authority: "Supreme Court",
			date: "2024",
			itemType: "Case",
			title: "Example v Example",
		});
	});

	it("accepts canonical draft fields but rejects two names for one value", () => {
		expect(
			validateNativeItemDraft({
				itemType: "case",
				title: "Example v Example",
			}).payload,
		).toMatchObject({ title: "Example v Example" });

		expect(() =>
			validateNativeItemDraft({
				itemType: "case",
				caseName: "One title",
				title: "Another title",
			}),
		).toThrow("Use only one name for Case Name");

		expect(() =>
			validateNativeItemDraft({
				itemType: "book",
				language: "French",
				languageName: "English",
			}),
		).toThrow("Use only one name for Language");
	});

	it("can validate source child metadata before parent references are resolved", () => {
		expect(
			validateNativeItemDraft(
				{ itemType: "Attachment", title: "Imported PDF" },
				{ requireChildParent: false },
			).item,
		).toMatchObject({ itemType: "Attachment" });
		expect(
			validateNativeItemDraft(
				{
					annotationPosition: '{"pageIndex":0,"rects":[]}',
					annotationType: "highlight",
					itemType: "Annotation",
				},
				{ requireChildParent: false },
			).item,
		).toMatchObject({ itemType: "Annotation" });
	});

	it("accepts every field for every vendored Zotero item type", () => {
		for (const definition of getZoteroSchema().itemTypes) {
			const payload: Record<string, unknown> = {
				itemType: definition.itemType,
			};
			for (const field of definition.fields) {
				payload[field.field] = validFieldValue(field);
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

	it("round-trips every vendored field through canonical draft storage", () => {
		let checkedFields = 0;
		for (const definition of getZoteroSchema().itemTypes) {
			const payload: Record<string, unknown> = {
				itemType: definition.itemType,
			};
			const expected = new Map<string, string>();
			for (const field of definition.fields) {
				const value = validFieldValue(field);
				payload[field.field] = value;
				expected.set(field.field, value);
			}
			if (definition.itemType === "attachment") {
				payload.parentItem = "ABCD2345";
			}
			if (definition.itemType === "annotation") {
				Object.assign(payload, {
					annotationPosition: '{"pageIndex":0,"rects":[]}',
					annotationType: "highlight",
					parentItem: "ABCD2345",
				});
			}

			const validated = validateNativeItemDraft(payload);
			const editorPayload = adminCanonicalPayloadToItemFields(
				validated.payload,
				validated.item.itemType,
			);
			const editorDraft = adminCanonicalDraftToItemFields({
				itemKey: "ABCD2345",
				payload: validated.payload,
			});

			for (const descriptor of describeZoteroItemTypeFields(
				definition.itemType,
			)) {
				const expectedValue = expected.get(descriptor.field);
				expect(editorPayload[descriptor.field]).toBe(expectedValue);
				expect(editorDraft.payload[descriptor.field]).toBe(expectedValue);
				checkedFields += 1;
			}
		}
		expect(checkedFields).toBe(770);
	});

	it("preserves text identifiers and reports typed fields that are wrong", () => {
		expect(
			validateNativeItemDraft({
				DOI: "https://doi.org/10.1000/Example",
				ISBN: "978-0-306-40615-7",
				itemType: "book",
				url: "https://example.com/book",
			}).item,
		).toMatchObject({
			DOI: "https://doi.org/10.1000/Example",
			ISBN: "978-0-306-40615-7",
			url: "https://example.com/book",
		});

		for (const [field, value, message] of [
			["date", "2024-02-31", "Enter an exact date or a four-digit year"],
			["date", "2024-05", "Enter an exact date or a four-digit year"],
			["date", "Spring 2024", "Enter an exact date or a four-digit year"],
			["accessDate", "2024-99-99", "Enter a real access date or timestamp"],
			["url", "example.com", "Enter a full HTTP or HTTPS address"],
		] as const) {
			try {
				validateNativeItemDraft({ itemType: "book", [field]: value });
				expect.unreachable(`Expected ${field} validation to fail`);
			} catch (error) {
				expect(error).toMatchObject({
					fields: { [field]: expect.stringContaining(message) },
				});
			}
		}

		expect(() =>
			validateNativeItemDraft({
				itemType: "case",
				dateDecided: "2024-05",
			}),
		).toThrow("Check date decided");
	});

	it("enforces Zotero note and annotation limits", () => {
		expect(() =>
			validateNativeItemDraft({
				itemType: "Note",
				note: "n".repeat(500_001),
			}),
		).toThrow("Check note");

		const annotation = {
			annotationPosition: '{"pageIndex":0,"rects":[]}',
			annotationType: "note",
			itemType: "Annotation",
			parentItem: "ABCD2345",
		};
		for (const [field, payload, message] of [
			[
				"annotationText",
				{ ...annotation, annotationText: "Not allowed" },
				"Annotation Text is available only for highlights and underlines.",
			],
			[
				"annotationPageLabel",
				{ ...annotation, annotationPageLabel: "é".repeat(26) },
				"Shorten Annotation Page Label to 50 simple characters or fewer.",
			],
			[
				"annotationPosition",
				{
					...annotation,
					annotationPosition: JSON.stringify({ value: "p".repeat(65_536) }),
				},
				"Shorten Annotation Position to 65,535 simple characters or fewer.",
			],
		] as const) {
			try {
				validateNativeItemDraft(payload);
				expect.unreachable(`Expected ${field} validation to fail`);
			} catch (error) {
				expect(error).toMatchObject({ fields: { [field]: message } });
			}
		}
	});

	it("requires valid child metadata before publication", () => {
		for (const payload of [
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
				annotationType: "underline",
				annotationPosition: '{"pageIndex":0,"rects":[]}',
			}),
		).not.toThrow();
	});

	it("rejects direct collections on child records and malformed relations", () => {
		expect(() =>
			validateNativeItemDraft({
				collections: ["ABCD2345"],
				itemType: "Note",
				note: "Child note",
				parentItem: "ABCD2345",
			}),
		).toThrow("Child records inherit collections from their parent");
		expect(() =>
			validateNativeItemDraft({
				collections: ["ABCD2345"],
				itemType: "Note",
				note: "Standalone note",
			}),
		).not.toThrow();
		expect(() =>
			validateNativeItemDraft({
				collections: ["ABCD2345"],
				itemType: "Attachment",
				title: "Standalone file",
			}),
		).not.toThrow();

		expect(() =>
			validateNativeItemDraft({
				itemType: "Book",
				relations: { "dc:relation": { key: "bad" } },
			}),
		).toThrow("Check the record relationships");

		expect(() =>
			validateNativeItemDraft({
				itemType: "Book",
				relations: { unknown: "value" },
			}),
		).toThrow("Check the record relationships");

		expect(
			validateNativeItemDraft({
				itemType: "Book",
				relations: {
					"dc:relation":
						"http://zotero.org/users/123/items/ABCD2345",
					cited_by: 4,
					referenced_works: ["WXYZ6789"],
				},
			}).item.relations,
		).toEqual({
			"dc:relation": "http://zotero.org/users/123/items/ABCD2345",
			cited_by: 4,
			referenced_works: ["WXYZ6789"],
		});
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
			languageName: "en",
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
