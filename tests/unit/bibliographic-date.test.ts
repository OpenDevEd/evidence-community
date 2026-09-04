import { describe, expect, it } from "vitest";

import {
	bibliographicDateSearchFields,
	parseBibliographicDate,
} from "@/lib/bibliographic-date";

describe("bibliographic dates", () => {
	it.each([
		["2024", { precision: "year", year: 2024, sortKey: 20240000 }],
		["2024-05", { precision: "month", year: 2024, sortKey: 20240500 }],
		[
			"2024-05-20",
			{
				isoDate: "2024-05-20",
				precision: "day",
				year: 2024,
				sortKey: 20240520,
			},
		],
	])("understands the supported date %s", (value, expected) => {
		expect(parseBibliographicDate(value)).toMatchObject({
			kind: "parsed",
			raw: value,
			...expected,
		});
	});

	it.each([
		"Spring 2024",
		"forthcoming",
		"2024-13",
		"2024-02-30",
		"2024-13-99",
	])(
		"rejects the unsupported or impossible value %s",
		(value) => {
			expect(parseBibliographicDate(value)).toEqual({
				kind: "invalid",
				raw: value,
			});
		},
	);

	it("trims the stored value and treats an empty value as absent", () => {
		expect(parseBibliographicDate("  2024  ")).toMatchObject({
			kind: "parsed",
			raw: "2024",
		});
		expect(parseBibliographicDate("   ")).toEqual({ kind: "empty", raw: "" });
	});

	it("projects only truthful fields for search", () => {
		expect(bibliographicDateSearchFields("2024")).toEqual({
			dateSortKey: 20240000,
			year: "2024",
		});
		expect(bibliographicDateSearchFields("2024-05-20")).toEqual({
			datePublished: "2024-05-20",
			dateSortKey: 20240520,
			year: "2024",
		});
		expect(bibliographicDateSearchFields("2024-05")).toEqual({
			dateSortKey: 20240500,
			year: "2024",
		});
		expect(bibliographicDateSearchFields("forthcoming")).toEqual({});
		expect(bibliographicDateSearchFields("2024-13-99")).toEqual({});
	});
});
