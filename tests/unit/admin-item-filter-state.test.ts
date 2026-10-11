import { describe, expect, it } from "vitest";

import { createLoader, createSerializer } from "nuqs/server";

import {
	DEFAULT_ADMIN_ITEM_VIEW_FILTERS,
	adminItemViewParsers,
	paramsFromView,
	setSingleAdminItemFilter,
	singleAdminItemFilterValue,
	viewFromParams,
} from "@/lib/admin/item-filter-state";
import { parseAdminItemFilters } from "@/lib/admin/item-list-contract";

describe("admin item filter URL state", () => {
	it("explains how to correct an invalid filter value", () => {
		expect(() =>
			parseAdminItemFilters([
				{ column: "title", operator: "contains", value: "" },
			]),
		).toThrow("Enter text for Title");
		expect(() =>
			parseAdminItemFilters([
				{ column: "collections", operator: "anyOf", value: [] },
			]),
		).toThrow("Choose at least one value for Collections");
		expect(() =>
			parseAdminItemFilters([
				{ column: "creators", operator: "contains", value: "" },
			]),
		).toThrow("Enter text for Creators");
		expect(() =>
			parseAdminItemFilters([
				{ column: "dateAdded", operator: "before", value: "" },
			]),
		).toThrow("Enter a valid date for Date added");
		expect(() =>
			parseAdminItemFilters([
				{ column: "fileState", operator: "anyOf", value: [] },
			]),
		).toThrow("Choose at least one value for PDF");
	});

	// As nuqs reads an address and writes one, without a browser.
	const load = createLoader(adminItemViewParsers);
	const address = createSerializer(adminItemViewParsers);
	const viewAt = (search: URLSearchParams) => viewFromParams(load(search));

	it("reads search, typed filters and sorting from the address", () => {
		const searchParams = new URLSearchParams({
			direction: "asc",
			filters: JSON.stringify([
				{ column: "state", operator: "anyOf", value: ["draft"] },
				{ column: "year", operator: "between", value: [2020, 2026] },
			]),
			review: "pending",
			search: "teacher development ",
			sort: "year",
		});

		expect(viewAt(searchParams)).toEqual({
			reviewQueue: true,
			filters: [
				{ column: "state", operator: "anyOf", value: ["draft"] },
				{ column: "year", operator: "between", value: [2020, 2026] },
			],
			// As typed, with its trailing space: the next word is on its way.
			query: "teacher development ",
			sort: "year",
			sortDirection: "asc",
		});
	});

	it("drops only malformed controls and keeps the rest of the address", () => {
		const searchParams = new URLSearchParams({
			direction: "sideways",
			filters: JSON.stringify([
				{ column: "title", operator: "between", value: [1, 2] },
			]),
			review: "maybe",
			search: "teacher",
			sort: "unknown",
		});

		expect(viewAt(searchParams)).toEqual({
			...DEFAULT_ADMIN_ITEM_VIEW_FILTERS,
			query: "teacher",
		});
		expect(viewAt(new URLSearchParams({ filters: "{not json" }))).toEqual(DEFAULT_ADMIN_ITEM_VIEW_FILTERS);
	});

	it("writes a view to the address without its defaults and without touching other parameters", () => {
		const next = new URLSearchParams(address("?locale=en&search=old&sort=title", paramsFromView({
			reviewQueue: true,
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
		})));

		expect(next.get("locale")).toBe("en");
		expect(next.get("review")).toBe("pending");
		expect(next.get("search")).toBe("reading");
		expect(next.get("sort")).toBeNull();
		expect(next.get("direction")).toBe("asc");
		expect(JSON.parse(next.get("filters")!)).toEqual([
			{ column: "fileState", operator: "anyOf", value: ["published"] },
		]);
		// The default view leaves nothing of its own in the address.
		expect(address("?locale=en&search=old&review=pending", paramsFromView(DEFAULT_ADMIN_ITEM_VIEW_FILTERS))).toBe("?locale=en");
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
