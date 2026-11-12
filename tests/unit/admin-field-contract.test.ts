import {
	describeZoteroField,
	getZoteroSchema,
} from "@opendeved/evidence-library-core/zotero-schema";
import { describe, expect, it } from "vitest";

import {
	adminFieldContract,
	normalizeAccessDate,
	normalizeAdminFieldValue,
} from "@/lib/admin/field-contract";
import { LANGUAGES, languageCode, languageName } from "@/lib/languages";

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
								: ["institution", "university"].includes(
											descriptor.field,
									  )
									? "institution-list"
									: multiline.has(descriptor.field)
										? "multiline"
										: descriptor.field === "language"
											? "language"
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
				adminFieldContract({
					field,
					semanticField: field,
					type: "text",
				}).kind,
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
			adminFieldContract(describeZoteroField({ field: "filingDate" }))
				.kind,
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
		["language", "language"],
	])("uses a %s control", (field, kind) => {
		expect(
			adminFieldContract({
				field,
				semanticField: field,
				type: "text",
			}).kind,
		).toBe(kind);
	});

	it("accepts only exact dates, months, and four-digit years", () => {
		const descriptor = describeZoteroField({ field: "date" });
		expect(normalizeAdminFieldValue(descriptor, "  2024  ")).toEqual({
			value: "2024",
		});
		expect(normalizeAdminFieldValue(descriptor, "2024-05")).toEqual({
			value: "2024-05",
		});
		for (const value of [
			"Spring 2024",
			"forthcoming",
			"2024-02-31",
			"2024-13",
		]) {
			expect(normalizeAdminFieldValue(descriptor, value)).toEqual({
				error: "Enter an exact date, a month, or a four-digit year.",
				value,
			});
		}
	});

	it("stores Zotero access dates as calendar dates", () => {
		const descriptor = {
			field: "accessDate",
			semanticField: "accessDate",
			type: "text" as const,
		};
		expect(normalizeAdminFieldValue(descriptor, "2024-05-20")).toEqual({
			value: "2024-05-20",
		});
		for (const value of [
			"2024-05-20 12:30:45",
			"2024-05-20T12:30:45.123Z",
			"2024-05-20T12:30:45+01:00",
			"2024-05-20T12:30:45+0100",
		]) {
			expect(normalizeAdminFieldValue(descriptor, value)).toEqual({
				value: "2024-05-20",
			});
		}
	});

	it("drops an access date that is not a calendar date instead of blocking the save", () => {
		// The editor uses a calendar control, so a non-date can only come from
		// old stored data (records published with the text CURRENT_TIMESTAMP
		// before the control existed) or an API caller. Blocking the save left
		// those records stuck; clearing the value lets the next save fix them.
		const descriptor = {
			field: "accessDate",
			semanticField: "accessDate",
			type: "text" as const,
		};
		for (const value of [
			"2024-99-99",
			"2024-05-20T25:00:00Z",
			"CURRENT_TIMESTAMP",
			"yesterday",
		]) {
			expect(normalizeAdminFieldValue(descriptor, value)).toEqual({
				value: "",
			});
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
		).toBe("This value is too long. Shorten it and try again.");
	});

	it("reads a stored language as one the editor offers, and keeps stored text as it is", () => {
		const language = { field: "language", semanticField: "language", type: "text" } as const;
		// Nothing saved is rewritten: a name, a tag and text that names no one language all stay.
		for (const stored of ["English", "en-GB", "English; French"]) expect(normalizeAdminFieldValue(language, stored)).toEqual({ value: stored });
		// Every language the editor offers reads back as itself, by its code and by its name, and is listed once.
		for (const { code, name } of LANGUAGES) expect([languageCode(code), languageCode(name)]).toEqual([code, code]);
		expect(new Set(LANGUAGES.map(({ name }) => name)).size).toBe(LANGUAGES.length);
		// The row the field shows as chosen for each stored form: one of the list's, or "" for a language it has no row for.
		expect(["eng", "en-US", "iw", "tw", "ceb", "Kiswahili", "English; French", "xx"].map(languageCode)).toEqual(["en", "en", "he", "ak", "", "", "", ""]);
		// A language without a two-letter code is shown by its name. Text that names none is flagged.
		expect(["ceb", "Cebuano", "Kiswahili", "English; French", "xx"].map(languageName)).toEqual(["Cebuano", "Cebuano", undefined, undefined, undefined]);
	});

	it("exposes the access date rule the public page uses to hide non-dates", () => {
		expect(normalizeAccessDate("2024-05-20T12:30:45Z")).toBe("2024-05-20");
		expect(normalizeAccessDate("CURRENT_TIMESTAMP")).toBeNull();
	});
});
