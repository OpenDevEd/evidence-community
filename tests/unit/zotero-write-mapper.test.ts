import { getZoteroItemTypes } from "@opendeved/evidence-library-core/zotero-schema";
import { describe, expect, it } from "vitest";

import { editableItemDatabaseFields } from "@/lib/admin/item-draft-patch";

import { itemType } from "@/db/schema/enums/itemType";
import {
	createZoteroItemPatch,
	createZoteroItemPayload,
	ZoteroWritebackMappingError,
} from "@/lib/source-writeback/zotero/mapper";

describe("Zotero writeback mapping", () => {
	it("omits library profile associations and affiliations from Zotero creators without changing their names", () => {
		const creator = {
			creatorType: "author",
			firstName: "Caitlin",
			lastName: "Mills",
			authorProfileId: "rs70m0zm30n946czwg6ek8z8j98e3j1p",
			// Zotero rejects a creator field it does not know.
			institutions: [{ display_name: "University of Nairobi" }],
		};
		const result = createZoteroItemPayload(
			{ itemType: "Report", creators: [creator] },
			"ABCD2345",
		);
		expect(result.creators).toEqual([
			{ creatorType: "author", firstName: "Caitlin", lastName: "Mills" },
		]);
		expect(
			createZoteroItemPayload(
				{ itemType: "Report", creators: [{ creatorType: "author", name: "UNESCO", organization: true }] },
				"ABCD2345",
			).creators,
		).toEqual([{ creatorType: "author", name: "UNESCO" }]);
		expect(creator.authorProfileId).toBe(
			"rs70m0zm30n946czwg6ek8z8j98e3j1p",
		);
	});

	it("maps every canonical item type to the vendored Zotero schema", () => {
		expect(itemType.enumValues).toHaveLength(getZoteroItemTypes().size);
		for (const canonicalItemType of itemType.enumValues) {
			const childFields =
				canonicalItemType === "Attachment" ||
				canonicalItemType === "Note"
					? { parentItem: "PARENT23" }
					: canonicalItemType === "Annotation"
						? {
								annotationPosition:
									'{"pageIndex":0,"rects":[]}',
								annotationType: "highlight",
								parentItem: "PARENT23",
							}
						: {};
			const result = createZoteroItemPayload(
				{ itemType: canonicalItemType, ...childFields },
				"ABCD2345",
			);
			expect(result.itemType).toBe(
				canonicalItemType[0]!.toLowerCase() +
					canonicalItemType.slice(1),
			);
			expect(result.key).toBe("ABCD2345");
			expect(result.tags).toEqual([]);
			expect(result.collections).toEqual([]);
			expect(result.relations).toEqual({});
			expect(result.version).toBe(0);
		}
	});

	it("requires a parent for attachments and rejects incomplete annotations", () => {
		expect(() =>
			createZoteroItemPayload({ itemType: "Attachment" }, "ATTACH23"),
		).toThrow(ZoteroWritebackMappingError);
		expect(() =>
			createZoteroItemPayload(
				{ itemType: "Attachment", parentItem: "PARENT23" },
				"ATTACH23",
			),
		).not.toThrow();
		expect(() =>
			createZoteroItemPayload(
				{
					annotationPosition: "not json",
					annotationType: "highlight",
					itemType: "Annotation",
					parentItem: "PARENT23",
				},
				"ANNP2345",
			),
		).toThrow(ZoteroWritebackMappingError);
	});

	it("maps Zotero structured fields and preserves valid scalar fields", () => {
		expect(
			createZoteroItemPayload(
				{
					collections: [],
					itemType: "Note",
					note: "A note",
					parentItem: "PARENT23",
					relations: {
						"dc:relation":
							"http://zotero.org/users/123/items/ABCD2345",
					},
					tags: ["evidence"],
				},
				"ABCD2345",
			),
		).toEqual({
			collections: [],
			itemType: "note",
			key: "ABCD2345",
			note: "A note",
			parentItem: "PARENT23",
			relations: {
				"dc:relation": "http://zotero.org/users/123/items/ABCD2345",
			},
			tags: [{ tag: "evidence" }],
			version: 0,
		});
	});

	it("maps creators using roles valid for the target item type", () => {
		expect(
			createZoteroItemPayload(
				{
					creators: [
						{
							creatorType: "author",
							firstName: "Ada",
							lastName: "Lovelace",
						},
					],
					itemType: "Report",
					title: "A report",
				},
				"ABCD2345",
			),
		).toMatchObject({
			creators: [
				{
					creatorType: "author",
					firstName: "Ada",
					lastName: "Lovelace",
				},
			],
		});
	});

	it("maps canonical fields back to the target Zotero field names", () => {
		expect(
			createZoteroItemPayload(
				{
					authority: "Supreme Court",
					date: "2024-05",
					itemType: "Case",
					title: "Example v Example",
				},
				"CASE2345",
			),
		).toMatchObject({
			caseName: "Example v Example",
			court: "Supreme Court",
			dateDecided: "2024-05",
			itemType: "case",
		});
		expect(
			createZoteroItemPatch(
				{
					date: "2025",
					itemType: "Statute",
					title: "Evidence Act",
				},
				["date", "title"],
			),
		).toEqual({
			dateEnacted: "2025",
			nameOfAct: "Evidence Act",
		});
		expect(
			createZoteroItemPayload(
				{
					itemType: "Report",
					languageName: "en",
					title: "Language mapping",
				},
				"LANG2345",
			),
		).toMatchObject({ language: "en" });
		expect(
			createZoteroItemPatch({ itemType: "Report", languageName: "ar" }, [
				"languageName",
			]),
		).toEqual({ language: "ar" });
		expect(
			createZoteroItemPatch({ itemType: "Report" }, ["languageName"]),
		).toEqual({ language: "" });
	});

	it("maps dirty removals to Zotero PATCH clear values", () => {
		expect(
			createZoteroItemPatch(
				{ itemType: "Report", title: "Current title" },
				[
					"tags",
					"title",
					"creators",
					"relations",
					"abstractNote",
					"collections",
				],
			),
		).toEqual({
			abstractNote: "",
			collections: [],
			creators: [],
			relations: {},
			tags: [],
			title: "Current title",
		});
		expect(
			createZoteroItemPatch(
				{ itemType: "Note", parentItem: "PARENT23" },
				["parentItem"],
			),
		).toEqual({ parentItem: "PARENT23" });
	});

	it("creates native attachments as linked PDF URLs", () => {
		expect(
			createZoteroItemPayload(
				{
					itemType: "Attachment",
					parentItem: "PARENT23",
					title: "Published PDF",
					url: "https://files.example.test/document.pdf",
				},
				"ATTACH23",
			),
		).toMatchObject({
			contentType: "application/pdf",
			itemType: "attachment",
			linkMode: "linked_url",
			parentItem: "PARENT23",
			url: "https://files.example.test/document.pdf",
		});
	});

	it("publishes and unpublishes attachment URLs without deleting metadata", () => {
		expect(
			createZoteroItemPatch(
				{
					itemType: "Attachment",
					parentItem: "PARENT23",
					tags: ["publish-record"],
					url: "https://files.example.test/document.pdf",
				},
				["tags", "url"],
			),
		).toEqual({
			tags: [{ tag: "publish-record" }],
			url: "https://files.example.test/document.pdf",
		});
		expect(
			createZoteroItemPatch(
				{ itemType: "Attachment", parentItem: "PARENT23" },
				["tags", "url"],
			),
		).toEqual({ tags: [], url: "" });
	});

	it("permits only clear operations for old fields during item-type changes", () => {
		expect(
			createZoteroItemPatch({ itemType: "Book" }, ["itemType", "type"], {
				previousItemType: "report",
			}),
		).toEqual({ itemType: "book", reportType: "" });
		expect(() =>
			createZoteroItemPatch(
				{ itemType: "Book", type: "Still present" },
				["itemType", "type"],
				{ previousItemType: "report" },
			),
		).toThrow(ZoteroWritebackMappingError);
		expect(createZoteroItemPatch({ itemType: "Book" }, ["type"])).toEqual(
			{},
		);
		expect(() =>
			createZoteroItemPatch({ itemType: "Book", type: "Present" }, [
				"type",
			]),
		).toThrow(ZoteroWritebackMappingError);
	});

	it("sends a restored record whole without naming fields of other item types", () => {
		// A tombstone restore marks every editable field dirty, itemType
		// included, while the type itself does not change.
		const everyField = [
			...editableItemDatabaseFields,
			"tags",
		];
		const patch = createZoteroItemPatch(
			{ itemType: "Book", title: "Restored" },
			everyField,
			{ previousItemType: "book" },
		);
		expect(patch.itemType).toBe("book");
		expect(patch.title).toBe("Restored");
		expect(
			Object.keys(patch).filter((key) => key.startsWith("annotation")),
		).toEqual([]);
		expect(patch).not.toHaveProperty("reportType");
	});

	it("never sends record links to Zotero as a field", () => {
		const payload = createZoteroItemPayload(
			{
				itemType: "Book",
				links: { cites: ["WXYZ6789"], related: ["QRST2345"] },
				title: "Linked book",
			},
			"BXXK2345",
		);
		expect(payload).not.toHaveProperty("links");
		expect(payload.title).toBe("Linked book");
		expect(payload.relations).toEqual({});
		expect(
			createZoteroItemPatch(
				{ itemType: "Book", links: { cites: [], related: [] } },
				["links"],
			),
		).toEqual({});
	});

	it("rejects invalid canonical fields instead of silently losing data", () => {
		expect(() =>
			createZoteroItemPayload(
				{ itemType: "Report", websiteTitle: "Wrong type" },
				"ABCD2345",
			),
		).toThrow(ZoteroWritebackMappingError);
		expect(() =>
			createZoteroItemPatch({ itemType: "Report" }, ["notAField"]),
		).toThrow(ZoteroWritebackMappingError);
		expect(() =>
			createZoteroItemPayload({ itemType: "Report" }, "INVALID1"),
		).toThrow(ZoteroWritebackMappingError);
		expect(() =>
			createZoteroItemPayload(
				{
					creators: [{ creatorType: "artist", name: "Wrong role" }],
					itemType: "Report",
				},
				"ABCD2345",
			),
		).toThrow(ZoteroWritebackMappingError);
	});
});
