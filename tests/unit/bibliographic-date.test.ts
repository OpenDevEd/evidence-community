import { describe, expect, it } from "vitest";

import { parseBibliographicDate } from "@/lib/bibliographic-date";

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
		["Spring 2024", { precision: "season", year: 2024, sortKey: 20240300 }],
	])("understands %s without inventing missing date parts", (value, expected) => {
		expect(parseBibliographicDate(value)).toMatchObject({
			kind: "parsed",
			raw: value,
			...expected,
		});
	});

	it("keeps flexible bibliographic text without deriving a fake date", () => {
		expect(parseBibliographicDate("forthcoming")).toEqual({
			kind: "literal",
			raw: "forthcoming",
		});
	});

	it.each(["2024-13", "2024-02-30", "2024-13-99"])(
		"rejects the impossible date-like value %s",
		(value) => {
			expect(parseBibliographicDate(value)).toEqual({
				kind: "invalid",
				raw: value,
			});
		},
	);

	it("trims the stored value and treats an empty value as absent", () => {
		expect(parseBibliographicDate("  2024-05  ")).toMatchObject({
			kind: "parsed",
			raw: "2024-05",
		});
		expect(parseBibliographicDate("   ")).toEqual({ kind: "empty", raw: "" });
	});
});
