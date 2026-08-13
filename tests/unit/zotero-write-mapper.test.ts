import { getZoteroItemTypes } from "@opendeved/evidence-library-core/zotero-schema";
import { describe, expect, it } from "vitest";

import { itemType } from "@/db/schema/enums/itemType";
import {
	createZoteroItemPatch,
	createZoteroItemPayload,
	ZoteroWritebackMappingError,
} from "@/lib/source-writeback/zotero/mapper";

describe("Zotero writeback mapping", () => {
	it("maps every canonical item type to the vendored Zotero schema", () => {
		expect(itemType.enumValues).toHaveLength(getZoteroItemTypes().size);
		for (const canonicalItemType of itemType.enumValues) {
			const childFields =
				canonicalItemType === "Attachment"
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

	it("rejects incomplete child records before calling Zotero", () => {
		expect(() =>
			createZoteroItemPayload({ itemType: "Attachment" }, "ATTACH23"),
		).toThrow(ZoteroWritebackMappingError);
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
					collections: ["COLL2345"],
					itemType: "Note",
					note: "A note",
					parentItem: "PARENT23",
					relations: { "dc:relation": "https://example.test/item" },
					tags: ["evidence"],
				},
				"ABCD2345",
			),
		).toEqual({
			collections: ["COLL2345"],
			itemType: "note",
			key: "ABCD2345",
			note: "A note",
			parentItem: "PARENT23",
			relations: { "dc:relation": "https://example.test/item" },
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
			createZoteroItemPatch({ itemType: "Note" }, ["parentItem"]),
		).toEqual({ parentItem: false });
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
			createZoteroItemPatch({ itemType: "Book" }, [
				"itemType",
				"type",
			], { previousItemType: "report" }),
		).toEqual({ itemType: "book", reportType: "" });
		expect(() =>
			createZoteroItemPatch(
				{ itemType: "Book", type: "Still present" },
				["itemType", "type"],
				{ previousItemType: "report" },
			),
		).toThrow(ZoteroWritebackMappingError);
		expect(() =>
			createZoteroItemPatch({ itemType: "Book" }, ["type"]),
		).toThrow(ZoteroWritebackMappingError);
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
