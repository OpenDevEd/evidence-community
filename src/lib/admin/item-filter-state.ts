import {
	ADMIN_ITEM_SORT_COLUMN_IDS,
	parseAdminItemFilters,
	type AdminItemColumnId,
	type AdminItemFilter,
	type AdminItemSortColumnId,
} from "./item-list-contract";
import type { AdminItemViewFilters } from "./types";

export const DEFAULT_ADMIN_ITEM_VIEW_FILTERS: AdminItemViewFilters = {
	filters: [],
	query: "",
	sort: "updated",
	sortDirection: "desc",
};

function parseJson(value: string | null): unknown {
	if (!value) return [];
	try {
		return JSON.parse(value);
	} catch {
		return [];
	}
}

export function parseAdminItemViewFilters(
	searchParams: URLSearchParams,
): AdminItemViewFilters {
	let filters: AdminItemFilter[] = [];
	try {
		filters = parseAdminItemFilters(parseJson(searchParams.get("filters")));
	} catch {
		// Keep the other valid URL controls when only the filter payload is stale.
	}
	const requestedSort = searchParams.get("sort");
	const sort = ADMIN_ITEM_SORT_COLUMN_IDS.includes(
		requestedSort as AdminItemSortColumnId,
	)
		? (requestedSort as AdminItemSortColumnId)
		: DEFAULT_ADMIN_ITEM_VIEW_FILTERS.sort;
	const requestedDirection = searchParams.get("direction");
	return {
		filters,
		query: (searchParams.get("search") ?? "").trim().slice(0, 500),
		sort,
		sortDirection:
			requestedDirection === "asc" || requestedDirection === "desc"
				? requestedDirection
				: DEFAULT_ADMIN_ITEM_VIEW_FILTERS.sortDirection,
	};
}

export function writeAdminItemViewFilters(
	searchParams: URLSearchParams,
	view: AdminItemViewFilters,
) {
	const next = new URLSearchParams(searchParams);
	for (const key of ["direction", "filters", "search", "sort"]) {
		next.delete(key);
	}
	if (view.query) next.set("search", view.query);
	if (view.filters.length > 0) {
		next.set("filters", JSON.stringify(view.filters));
	}
	if (view.sort !== "updated") next.set("sort", view.sort);
	if (view.sortDirection !== "desc") {
		next.set("direction", view.sortDirection);
	}
	return next;
}

export function singleAdminItemFilterValue(
	filters: readonly AdminItemFilter[],
	column: AdminItemColumnId,
): string | null | undefined {
	const filter = filters.find((entry) => entry.column === column);
	if (!filter) return undefined;
	return filter.operator === "anyOf" &&
		Array.isArray(filter.value) &&
		filter.value.length === 1
		? String(filter.value[0])
		: null;
}

export function setSingleAdminItemFilter(
	filters: readonly AdminItemFilter[],
	column: AdminItemColumnId,
	value: string | null,
) {
	const next = filters.filter((entry) => entry.column !== column);
	if (value) next.push({ column, operator: "anyOf", value: [value] });
	return parseAdminItemFilters(next);
}
