import { describeZoteroField } from "@opendeved/evidence-library-core/zotero-schema";
import { describe, expect, it } from "vitest";

import {
	adminFieldContract,
	normalizeAdminFieldValue,
} from "@/lib/admin/field-contract";

describe("admin metadata field contract", () => {
	it("inherits date controls through Zotero base fields", () => {
		expect(
			adminFieldContract(
				describeZoteroField({
					baseField: "date",
					field: "dateDecided",
				}),
			).kind,
		).toBe("bibliographic-date");
		expect(
			adminFieldContract(
				describeZoteroField({ field: "filingDate" }),
			).kind,
		).toBe("bibliographic-date");
	});

	it.each([
		["accessDate", "access-date"],
		["url", "url"],
		["DOI", "doi"],
		["ISBN", "isbn"],
		["ISSN", "issn"],
		["PMID", "pmid"],
		["PMCID", "pmcid"],
		["abstractNote", "multiline"],
		["annotationText", "multiline"],
		["annotationType", "annotation-type"],
		["annotationColor", "color"],
	])("uses a %s control", (field, kind) => {
		expect(
			adminFieldContract({
				field,
				semanticField: field,
				type: "text",
			}).kind,
		).toBe(kind);
	});

	it("keeps flexible dates but rejects impossible calendar-shaped dates", () => {
		const descriptor = describeZoteroField({ field: "date" });
		expect(normalizeAdminFieldValue(descriptor, "  Spring 2024  ")).toEqual({
			value: "Spring 2024",
		});
		expect(normalizeAdminFieldValue(descriptor, "2024-02-31")).toEqual({
			error: "Enter a real date, month, year, season, or other date text.",
			value: "2024-02-31",
		});
	});

	it("validates dates, links, and identifiers using their real formats", () => {
		expect(
			normalizeAdminFieldValue(
				{ field: "accessDate", semanticField: "accessDate", type: "text" },
				"2024-05-20",
			),
		).toEqual({ value: "2024-05-20" });
		expect(
			normalizeAdminFieldValue(
				{ field: "url", semanticField: "url", type: "text" },
				"example.com",
			).error,
		).toBe("Enter a full HTTP or HTTPS address.");
		expect(
			normalizeAdminFieldValue(
				{ field: "DOI", semanticField: "DOI", type: "text" },
				"https://doi.org/10.1000/Example",
			),
		).toEqual({ value: "10.1000/example" });
		expect(
			normalizeAdminFieldValue(
				{ field: "ISBN", semanticField: "ISBN", type: "text" },
				"978-0-306-40615-7",
			),
		).toEqual({ value: "978-0-306-40615-7" });
		expect(
			normalizeAdminFieldValue(
				{ field: "ISSN", semanticField: "ISSN", type: "text" },
				"2049-3630",
			),
		).toEqual({ value: "2049-3630" });
		expect(
			normalizeAdminFieldValue(
				{ field: "PMID", semanticField: "PMID", type: "text" },
				"abc",
			).error,
		).toBe("Enter the PMID as digits only.");
		expect(
			normalizeAdminFieldValue(
				{ field: "PMCID", semanticField: "PMCID", type: "text" },
				"12345",
			),
		).toEqual({ value: "PMC12345" });
	});
});
