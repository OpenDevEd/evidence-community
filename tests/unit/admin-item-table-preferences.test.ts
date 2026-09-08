import { describe, expect, it } from "vitest";

import {
	ADMIN_ITEM_TABLE_DEFAULT_PREFERENCES,
	adminItemTableRowHeight,
	moveAdminItemTableColumn,
	normalizeAdminItemTablePreferences,
	requestedAdminItemColumns,
} from "@/lib/admin/item-table-preferences";

describe("admin item table preferences", () => {
	it("uses the registry order and visibility defaults", () => {
		expect(ADMIN_ITEM_TABLE_DEFAULT_PREFERENCES.columnOrder).toEqual([
			"select",
			"title",
			"creators",
			"year",
			"state",
			"fileState",
			"updated",
			"itemType",
			"kind",
			"source",
			"collections",
			"tags",
			"dateAdded",
			"key",
			"revision",
			"pageCount",
		]);
		expect(
			requestedAdminItemColumns(ADMIN_ITEM_TABLE_DEFAULT_PREFERENCES),
		).toEqual([
			"select",
			"title",
			"creators",
			"year",
			"state",
			"fileState",
			"updated",
		]);
	});

	it("sanitizes stale and malformed persisted state", () => {
		const preferences = normalizeAdminItemTablePreferences({
			columnOrder: ["tags", "select", "tags", "removed", "year"],
			columnSizing: {
				select: 900,
				tags: 310,
				title: 100,
				year: Number.NaN,
			},
			columnVisibility: {
				creators: false,
				removed: true,
				select: false,
				tags: true,
				title: false,
			},
			density: "unknown",
			version: 1,
		});

		expect(preferences.columnOrder.slice(0, 4)).toEqual([
			"select",
			"title",
			"tags",
			"year",
		]);
		expect(new Set(preferences.columnOrder).size).toBe(16);
		expect(preferences.columnVisibility.select).toBe(true);
		expect(preferences.columnVisibility.title).toBe(true);
		expect(preferences.columnVisibility.creators).toBe(false);
		expect(preferences.columnVisibility.tags).toBe(true);
		expect(preferences.columnSizing).toEqual({ tags: 310 });
		expect(preferences.density).toBe("comfortable");
	});

	it("rejects unknown preference versions instead of guessing", () => {
		expect(
			normalizeAdminItemTablePreferences({
				columnVisibility: { tags: true },
				version: 99,
			}),
		).toEqual(ADMIN_ITEM_TABLE_DEFAULT_PREFERENCES);
	});

	it("keeps required columns pinned while optional columns move", () => {
		const order = ADMIN_ITEM_TABLE_DEFAULT_PREFERENCES.columnOrder;
		expect(moveAdminItemTableColumn(order, "select", "down")).toEqual(
			order,
		);
		expect(moveAdminItemTableColumn(order, "title", "down")).toEqual(order);

		const moved = moveAdminItemTableColumn(order, "year", "up");
		expect(moved.slice(0, 5)).toEqual([
			"select",
			"title",
			"year",
			"creators",
			"state",
		]);
		expect(moveAdminItemTableColumn(moved, "year", "up")).toEqual(moved);
	});

	it("maps density to stable computed row heights", () => {
		expect(adminItemTableRowHeight("compact")).toBe(44);
		expect(adminItemTableRowHeight("comfortable")).toBe(56);
		expect(adminItemTableRowHeight("spacious")).toBe(64);
	});
});
