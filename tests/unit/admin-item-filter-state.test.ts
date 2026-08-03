import { describe, expect, it } from "vitest";

import {
	DEFAULT_ADMIN_ITEM_VIEW_FILTERS,
	parseAdminItemViewFilters,
	setSingleAdminItemFilter,
	singleAdminItemFilterValue,
	writeAdminItemViewFilters,
} from "@/lib/admin/item-filter-state";

describe("admin item filter URL state", () => {
	it("parses valid search, typed filters, and sorting", () => {
		const searchParams = new URLSearchParams({
			direction: "asc",
			filters: JSON.stringify([
				{ column: "state", operator: "anyOf", value: ["draft"] },
				{ column: "year", operator: "between", value: [2020, 2026] },
			]),
			search: "  teacher development  ",
			sort: "year",
		});

		expect(parseAdminItemViewFilters(searchParams)).toEqual({
			filters: [
				{ column: "state", operator: "anyOf", value: ["draft"] },
				{ column: "year", operator: "between", value: [2020, 2026] },
			],
			query: "teacher development",
			sort: "year",
			sortDirection: "asc",
		});
	});

	it("drops only malformed controls and preserves valid URL state", () => {
		const searchParams = new URLSearchParams({
			direction: "sideways",
			filters: JSON.stringify([
				{ column: "title", operator: "between", value: [1, 2] },
			]),
			search: "teacher",
			sort: "unknown",
		});

		expect(parseAdminItemViewFilters(searchParams)).toEqual({
			...DEFAULT_ADMIN_ITEM_VIEW_FILTERS,
			query: "teacher",
		});
	});

	it("writes canonical state without deleting unrelated parameters", () => {
		const searchParams = new URLSearchParams(
			"locale=en&search=old&sort=title",
		);
		const next = writeAdminItemViewFilters(searchParams, {
			filters: [
				{
					column: "fileState",
					operator: "anyOf",
					value: ["published"],
				},
			],
			query: "reading",
			sort: "updated",
			sortDirection: "asc",
		});

		expect(next.get("locale")).toBe("en");
		expect(next.get("search")).toBe("reading");
		expect(next.get("sort")).toBeNull();
		expect(next.get("direction")).toBe("asc");
		expect(JSON.parse(next.get("filters")!)).toEqual([
			{ column: "fileState", operator: "anyOf", value: ["published"] },
		]);
	});

	it("upserts and removes navigation filters without duplicates", () => {
		const initial = [
			{ column: "title", operator: "contains", value: "teacher" },
			{ column: "state", operator: "anyOf", value: ["draft"] },
		] as const;
		const updated = setSingleAdminItemFilter(initial, "state", "published");

		expect(updated).toEqual([
			{ column: "title", operator: "contains", value: "teacher" },
			{ column: "state", operator: "anyOf", value: ["published"] },
		]);
		expect(singleAdminItemFilterValue(updated, "state")).toBe("published");
		expect(singleAdminItemFilterValue(updated, "source")).toBeUndefined();
		expect(
			singleAdminItemFilterValue(
				[
					{
						column: "state",
						operator: "anyOf",
						value: ["draft", "published"],
					},
				],
				"state",
			),
		).toBeNull();
		expect(
			singleAdminItemFilterValue(
				[{ column: "collections", operator: "hasValue" }],
				"collections",
			),
		).toBeNull();
		expect(
			singleAdminItemFilterValue(
				[{ column: "collections", operator: "hasNoValue" }],
				"collections",
			),
		).toBeNull();
		expect(setSingleAdminItemFilter(updated, "state", null)).toEqual([
			{ column: "title", operator: "contains", value: "teacher" },
		]);
	});
});
