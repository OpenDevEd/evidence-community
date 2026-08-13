import {
	describeZoteroField,
	getZoteroSchema,
} from "@opendeved/evidence-library-core/zotero-schema";
import { describe, expect, it } from "vitest";

import {
	adminFieldContract,
	normalizeAdminFieldValue,
} from "@/lib/admin/field-contract";

describe("admin metadata field contract", () => {
	it("classifies every vendored field from one complete policy", () => {
		const multiline = new Set([
			"abstractNote",
			"extra",
			"history",
			"references",
		]);
		const distinctFields = new Set<string>();
		let checked = 0;
		for (const definition of getZoteroSchema().itemTypes) {
			for (const field of definition.fields) {
				const descriptor = describeZoteroField(field);
				const expected =
					descriptor.type === "date"
						? "bibliographic-date"
						: descriptor.field === "accessDate"
							? "access-date"
							: descriptor.field === "url"
								? "url"
								: multiline.has(descriptor.field)
									? "multiline"
									: "text";
				expect(adminFieldContract(descriptor).kind).toBe(expected);
				distinctFields.add(descriptor.field);
				checked += 1;
			}
		}
		expect(checked).toBe(770);
		expect(distinctFields.size).toBe(121);
	});

	it("keeps all number-looking bibliographic values as text", () => {
		const fields = [
			"applicationNumber",
			"archiveID",
			"artworkSize",
			"billNumber",
			"codeNumber",
			"codePages",
			"codeVolume",
			"docketNumber",
			"documentNumber",
			"edition",
			"episodeNumber",
			"firstPage",
			"identifier",
			"issue",
			"number",
			"numberOfVolumes",
			"numPages",
			"pages",
			"partNumber",
			"patentNumber",
			"priorityNumbers",
			"publicLawNumber",
			"reporterVolume",
			"reportNumber",
			"runningTime",
			"scale",
			"section",
			"seriesNumber",
			"session",
			"versionNumber",
			"volume",
		];
		for (const field of fields) {
			expect(
				adminFieldContract({ field, semanticField: field, type: "text" }).kind,
			).toBe("text");
		}
		expect(fields).toHaveLength(31);
	});

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
		["DOI", "text"],
		["ISBN", "text"],
		["ISSN", "text"],
		["PMID", "text"],
		["PMCID", "text"],
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

	it("accepts only exact dates and four-digit years", () => {
		const descriptor = describeZoteroField({ field: "date" });
		expect(normalizeAdminFieldValue(descriptor, "  2024  ")).toEqual({
			value: "2024",
		});
		for (const value of ["2024-05", "Spring 2024", "forthcoming", "2024-02-31"]) {
			expect(normalizeAdminFieldValue(descriptor, value)).toEqual({
				error: "Enter an exact date or a four-digit year.",
				value,
			});
		}
	});

	it("accepts every Zotero access-date format", () => {
		const descriptor = {
			field: "accessDate",
			semanticField: "accessDate",
			type: "text" as const,
		};
		for (const value of [
			"2024-05-20",
			"2024-05-20 12:30:45",
			"2024-05-20T12:30:45.123Z",
			"2024-05-20T12:30:45+01:00",
			"2024-05-20T12:30:45+0100",
			"-0044-03-15",
			"CURRENT_TIMESTAMP",
		]) {
			expect(normalizeAdminFieldValue(descriptor, value)).toEqual({ value });
		}
		for (const value of ["2024-99-99", "2024-05-20T25:00:00Z", "yesterday"]) {
			expect(normalizeAdminFieldValue(descriptor, value).error).toBe(
				"Enter a real access date or timestamp.",
			);
		}
	});

	it("validates links but preserves Zotero identifiers as text", () => {
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
		).toEqual({ value: "https://doi.org/10.1000/Example" });
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
			),
		).toEqual({ value: "abc" });
		expect(
			normalizeAdminFieldValue(
				{ field: "PMCID", semanticField: "PMCID", type: "text" },
				"12345",
			),
		).toEqual({ value: "12345" });
	});

	it("rejects ordinary Zotero fields larger than 65,535 bytes", () => {
		expect(
			normalizeAdminFieldValue(
				{ field: "title", semanticField: "title", type: "text" },
				"é".repeat(32_768),
			).error,
		).toBe("Shorten this field to 65,535 simple characters or fewer.");
	});
});
