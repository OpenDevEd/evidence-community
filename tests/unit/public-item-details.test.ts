import { describe, expect, it } from "vitest";

import {
	describeZoteroItemTypeFields,
	getZoteroSchema,
} from "@opendeved/evidence-library-core/zotero-schema";
import enGBMessages from "@/messages/en-GB.json";
import { selectPublicItemDetails } from "@/lib/public-item-details";

describe("public item details", () => {
	it("shows only real item-type metadata fields", () => {
		expect(
			selectPublicItemDetails(
				{
					collections: [],
					createdAt: "2026-08-13T12:46:34.376Z",
					itemType: "Report",
					key: "REPORT01",
					languageName: "English",
					metadataSearch: [
						"2026-08-13T12:46:34.376Z",
						"Report",
						"A report",
					],
					number: "R-12",
					title: "A report",
					type: "Evidence review",
					updatedAt: "2026-08-13T12:47:19.279Z",
					url: "https://library.example.org/lib/REPORT01",
				},
				"https://library.example.org",
			),
		).toEqual([
			{ label: "reportNumber", value: "R-12" },
			{ label: "reportType", value: "Evidence review" },
			{ label: "language", value: "English" },
		]);
	});

	it("has labels for every field in the Zotero schema", () => {
		const missingFields = [
			...new Set(
				getZoteroSchema().itemTypes.flatMap(({ itemType }) =>
					describeZoteroItemTypeFields(itemType).map(({ field }) => field),
				),
			),
		].filter((field) => !Object.hasOwn(enGBMessages.article, field));

		expect(missingFields).toEqual([]);
	});

	it("keeps an external source URL but hides the library's own item URL", () => {
		const common = {
			itemType: "Report",
			key: "REPORT01",
		};
		expect(
			selectPublicItemDetails(
				{ ...common, url: "https://source.example.org/report" },
				"https://library.example.org",
			),
		).toContainEqual({
			label: "url",
			value: "https://source.example.org/report",
		});
		expect(
			selectPublicItemDetails(
				{ ...common, url: "https://library.example.org/lib/REPORT01" },
				"https://library.example.org",
			),
		).toEqual([]);
	});

	it("shows a real publisher using the item-specific Zotero label", () => {
		expect(
			selectPublicItemDetails(
				{ itemType: "Book", key: "BOOK0001", publisher: "OpenDevEd" },
				"https://library.example.org",
			),
		).toContainEqual({ label: "publisher", value: "OpenDevEd" });
		expect(
			selectPublicItemDetails(
				{ itemType: "Report", key: "REPORT01", publisher: "OpenDevEd" },
				"https://library.example.org",
			),
		).toContainEqual({ label: "institution", value: "OpenDevEd" });
	});
});
