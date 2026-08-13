import { describe, expect, it } from "vitest";

import {
	canonicalZoteroFieldName,
	describeZoteroField,
	describeZoteroItemTypeFields,
	getZoteroItemType,
	getZoteroItemTypes,
	getZoteroSchema,
	itemTypeZoteroFieldName,
} from "./zotero-schema.js";

describe("vendored Zotero schema", () => {
	it("loads the pinned schema without network access", () => {
		expect(getZoteroSchema().version).toBe(44);
		expect(getZoteroItemTypes().size).toBe(40);
	});

	it("exposes the fields and creator types for each item type", () => {
		const book = getZoteroItemType("book");

		expect(book?.fields.map(({ field }) => field)).toContain("title");
		expect(
			book?.creatorTypes.map(({ creatorType }) => creatorType),
		).toContain("author");
		expect(getZoteroItemType("not-a-real-type")).toBeNull();
	});

	it("describes direct and inherited field meaning", () => {
		expect(describeZoteroField({ field: "filingDate" })).toEqual({
			field: "filingDate",
			semanticField: "filingDate",
			type: "date",
		});
		expect(
			describeZoteroField({ field: "dateDecided", baseField: "date" }),
		).toEqual({
			baseField: "date",
			field: "dateDecided",
			semanticField: "date",
			type: "date",
		});
		expect(
			describeZoteroField({ field: "caseName", baseField: "title" }),
		).toEqual({
			baseField: "title",
			field: "caseName",
			semanticField: "title",
			type: "text",
		});
	});

	it("converts every item-specific field to one canonical field and back", () => {
		for (const definition of getZoteroSchema().itemTypes) {
			const descriptors = describeZoteroItemTypeFields(
				definition.itemType,
			);
			expect(descriptors).toHaveLength(definition.fields.length);
			expect(
				new Set(descriptors.map(({ semanticField }) => semanticField)).size,
			).toBe(descriptors.length);

			for (const descriptor of descriptors) {
				expect(
					canonicalZoteroFieldName(
						definition.itemType,
						descriptor.field,
					),
				).toBe(descriptor.semanticField);
				expect(
					itemTypeZoteroFieldName(
						definition.itemType,
						descriptor.semanticField,
					),
				).toBe(descriptor.field);
			}
		}
	});
});
