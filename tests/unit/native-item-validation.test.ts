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
import {
	sourceRecordValidationOptions,
	validateNativeItemDraft,
    inspectNativeItemDraft,
} from "@/lib/admin/native-item-validation";

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
	it("preserves profile associations without changing bibliographic names or order", () => {
		const creators = [
			{
				creatorType: "author",
				firstName: "Caitlin",
				lastName: "Mills",
				authorProfileId: "rs70m0zm30n946czwg6ek8z8j98e3j1p",
			},
			{ creatorType: "author", name: "Research team" },
		];
		const result = validateNativeItemDraft({
			itemType: "report",
			title: "Attention",
			creators,
		});
		expect(result.payload.creators).toEqual(creators);
		expect(result.item.creators).toEqual(creators);
	});

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

	it("rejects an attachment without a parent record", () => {
		try {
			validateNativeItemDraft({
				itemType: "Attachment",
				title: "Loose PDF",
			});
			expect.unreachable("A parentless attachment must not validate");
		} catch (error) {
			expect(error).toMatchObject({
				fields: {
					parentItem: "Choose the record this attachment belongs to.",
				},
			});
		}
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
			if (
				definition.itemType === "attachment" ||
				definition.itemType === "note"
			) {
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
			if (
				definition.itemType === "attachment" ||
				definition.itemType === "note"
			) {
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
				expect(editorDraft.payload[descriptor.field]).toBe(
					expectedValue,
				);
				checkedFields += 1;
			}
		}
		expect(checkedFields).toBe(770);
	});

	it("keeps external source values the editor would reject", () => {
		// The source owns the record: an unusual date or address is stored as
		// text, an unknown field is left out, an unknown relation type and a
		// missing title are fine. The editor still rejects all of them.
		const sourceRecord = {
			itemType: "book",
			date: "Spring 2024",
			url: "zotero://select/groups/1/items/AAAA2345",
			futureZoteroField: "kept in raw only",
			relations: {
				"dc:relation": "http://zotero.org/groups/1/items/BBBB2345",
				"future:relation": "x",
			},
		};
		const validated = validateNativeItemDraft(
			sourceRecord,
			sourceRecordValidationOptions,
		);
		expect(validated.item).toMatchObject({
			date: "Spring 2024",
			url: "zotero://select/groups/1/items/AAAA2345",
			relations: { "future:relation": "x" },
		});
		expect(validated.item).not.toHaveProperty("futureZoteroField");
		expect(validated.item).not.toHaveProperty("title");

		expect(() =>
			validateNativeItemDraft(sourceRecord, { requireTitle: true }),
		).toThrow();
		// Only the format check is relaxed; the length limit still applies.
        expect(inspectNativeItemDraft({itemType: "book", url: "x".repeat(70_000)}, sourceRecordValidationOptions).fields).toHaveProperty("url");
		expect(() =>
			validateNativeItemDraft(
				{
					itemType: "book",
					creators: [{ creatorType: "director", name: "A" }],
				},
				sourceRecordValidationOptions,
			),
		).toThrow("Choose a valid creator role.");
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
			[
				"date",
				"2024-02-31",
				"Enter an exact date, a month, or a four-digit year",
			],
			[
				"date",
				"Spring 2024",
				"Enter an exact date, a month, or a four-digit year",
			],
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

        expect(inspectNativeItemDraft({itemType: "case", dateDecided: "Spring 2024"}).fields).toHaveProperty("dateDecided");

		// A stored access date that is not a calendar date (issue #103) is
		// cleared on save instead of leaving the record impossible to edit.
		expect(
			validateNativeItemDraft({
				itemType: "book",
				accessDate: "CURRENT_TIMESTAMP",
			}).item,
		).toMatchObject({ accessDate: "" });
	});

	it("takes an editor's study type, or none to leave it to the reading, and refuses one that isn't a type", () => {
		expect(validateNativeItemDraft({ itemType: "journalArticle", studyType: "meta-analysis" }).payload).toMatchObject({ studyType: "meta-analysis" });
		expect(validateNativeItemDraft({ itemType: "journalArticle", studyType: null }).payload).toMatchObject({ studyType: null });
		expect(() => validateNativeItemDraft({ itemType: "journalArticle", studyType: "novel" })).toThrow();
	});

	it("requires a title only when publishing", () => {
		expect(
			validateNativeItemDraft({ itemType: "book", title: "" }).payload,
		).toMatchObject({ itemType: "Book", title: "" });

		let checked = 0;
		for (const definition of getZoteroSchema().itemTypes) {
			const titleDescriptor = describeZoteroItemTypeFields(
				definition.itemType,
			).find(({ semanticField }) => semanticField === "title");
			if (!titleDescriptor) continue;
			checked += 1;
			try {
				validateNativeItemDraft(
					{
						itemType: definition.itemType,
						[titleDescriptor.field]: "   ",
						...(definition.itemType === "attachment" ||
						definition.itemType === "note"
							? { parentItem: "ABCD2345" }
							: {}),
					},
					{ requireTitle: true },
				);
				expect.unreachable(
					`Expected ${definition.itemType} without a title to fail`,
				);
			} catch (error) {
				expect(error).toMatchObject({
					fields: {
						[titleDescriptor.field]:
							"Enter a title before publishing.",
					},
				});
			}
		}
		expect(checked).toBe(38);

		expect(
			validateNativeItemDraft(
				{ itemType: "book", title: "A complete record" },
				{ requireTitle: true },
			).payload,
		).toMatchObject({ title: "A complete record" });
	});

	it("enforces Zotero note and annotation limits", () => {
        expect(inspectNativeItemDraft({itemType: "Note", note: "n".repeat(500_001)}).fields).toHaveProperty("note");

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
				"Annotation Page Label is too long. Shorten it and try again.",
			],
			[
				"annotationPosition",
				{
					...annotation,
					annotationPosition: JSON.stringify({
						value: "p".repeat(65_536),
					}),
				},
				"Annotation Position is too long. Shorten it and try again.",
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
				itemType: "Attachment",
				parentItem: "ABCD2345",
				title: "Child file",
			}),
		).toThrow("Child records inherit collections from their parent");

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

		for (const legacyLinks of [
			{ cites: ["ABCD2345"] },
			{ citedBy: ["ABCD2345"] },
		]) {
			expect(() =>
				validateNativeItemDraft({
					itemType: "Book",
					relations: legacyLinks,
				}),
			).toThrow("Check the record relationships");
		}

		expect(() =>
			validateNativeItemDraft({
				itemType: "Book",
				relations: { cited_by: 4 },
			}),
		).toThrow("Check the record relationships");
		expect(() =>
			validateNativeItemDraft({
				itemType: "Book",
				relations: { referenced_works: ["WXYZ6789"] },
			}),
		).toThrow("Check the record relationships");
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

	// The creator card marks an organisation, since a person's whole name comes in one field from OpenAlex too.
	it("keeps an organisation's mark", () => {
		const organisation = { creatorType: "author", name: "UNESCO", organization: true };
		expect(validateNativeItemDraft({ itemType: "report", creators: [organisation] }).payload.creators).toEqual([organisation]);
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

	it("normalizes record links and rejects bad link lists", () => {
		expect(
			validateNativeItemDraft({
				itemType: "Book",
				links: {
					cites: [" WXYZ6789 ", "QRST2345"],
					related: ["WXYZ6789"],
				},
			}).links,
		).toEqual({ cites: ["QRST2345", "WXYZ6789"], related: ["WXYZ6789"] });
		expect(validateNativeItemDraft({ itemType: "Book" }).links).toEqual({
			cites: [],
			related: [],
		});
		expect(() =>
			validateNativeItemDraft({
				itemType: "Book",
				links: { cites: ["WXYZ6789", "WXYZ6789"], related: [] },
			}),
		).toThrow("Remove the duplicate");
		expect(() =>
			validateNativeItemDraft({
				itemType: "Book",
				links: { cites: ["not-a-key"], related: [] },
			}),
		).toThrow("Choose valid linked records.");
		expect(() =>
			validateNativeItemDraft({
				itemType: "Book",
				links: { cites: [], related: [], mentions: [] },
			}),
		).toThrow("Choose valid linked records.");
		expect(() =>
			validateNativeItemDraft({
				itemType: "Book",
				links: {
					cites: Array.from({ length: 501 }, (_, index) =>
						`K${String(2_000_000 + index)}`
							.replace(/0/g, "A")
							.replace(/1/g, "B"),
					),
					related: [],
				},
			}),
		).toThrow("Choose valid linked records.");
	});
});
