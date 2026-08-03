import { describe, expect, it } from "vitest";

import {
	ADMIN_ITEM_DEFAULT_COLUMNS,
	ADMIN_ITEM_LIST_COLUMNS,
	ADMIN_ITEM_SORT_COLUMN_IDS,
	parseAdminItemListRequest,
} from "@/lib/admin/item-list-contract";

describe("admin item list contract", () => {
	it("defines one unique registry with the intended default columns", () => {
		expect(ADMIN_ITEM_DEFAULT_COLUMNS).toEqual([
			"select",
			"title",
			"creators",
			"year",
			"state",
			"fileState",
			"updated",
		]);
		expect(new Set(ADMIN_ITEM_LIST_COLUMNS.map(({ id }) => id)).size).toBe(
			ADMIN_ITEM_LIST_COLUMNS.length,
		);
		expect(
			ADMIN_ITEM_LIST_COLUMNS.filter(
				({ defaultVisible }) => defaultVisible,
			).map(({ id }) => id),
		).toEqual(ADMIN_ITEM_DEFAULT_COLUMNS);
		expect(
			ADMIN_ITEM_LIST_COLUMNS.filter(({ sortable }) => sortable).map(
				({ id }) => id,
			),
		).toEqual(ADMIN_ITEM_SORT_COLUMN_IDS);
	});

	it("applies the default list request through the public parser", () => {
		expect(parseAdminItemListRequest({})).toEqual({
			cursor: null,
			filters: [],
			pageSize: 50,
			requestedColumns: ADMIN_ITEM_DEFAULT_COLUMNS,
			search: "",
			sorting: [{ column: "updated", direction: "desc" }],
		});
	});

	it("accepts field-appropriate filters", () => {
		const request = parseAdminItemListRequest({
			filters: [
				{
					column: "state",
					operator: "anyOf",
					value: ["draft", "edited"],
				},
				{
					column: "updated",
					operator: "between",
					value: ["2026-07-01", "2026-07-31"],
				},
				{
					column: "pageCount",
					operator: "hasValue",
				},
			],
			search: "teacher training",
		});

		expect(request.filters).toHaveLength(3);
		expect(request.search).toBe("teacher training");
	});

	it("rejects operators that do not belong to the selected field", () => {
		expect(() =>
			parseAdminItemListRequest({
				filters: [
					{
						column: "title",
						operator: "between",
						value: [1, 2],
					},
				],
			}),
		).toThrow(/Title does not support the between filter/u);
	});

	it("rejects impossible dates and reversed ranges", () => {
		expect(() =>
			parseAdminItemListRequest({
				filters: [
					{
						column: "updated",
						operator: "before",
						value: "2026-13-99",
					},
				],
			}),
		).toThrow(/Updated has an invalid value/u);

		expect(() =>
			parseAdminItemListRequest({
				filters: [
					{
						column: "year",
						operator: "between",
						value: [2026, 1990],
					},
				],
			}),
		).toThrow(/Year has an invalid value/u);
	});

	it("rejects duplicate filters for the same column", () => {
		expect(() =>
			parseAdminItemListRequest({
				filters: [
					{ column: "state", operator: "anyOf", value: ["draft"] },
					{
						column: "state",
						operator: "anyOf",
						value: ["published"],
					},
				],
			}),
		).toThrow(/Each column can only be filtered once/u);
	});
});
