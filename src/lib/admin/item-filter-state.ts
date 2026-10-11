import {
	ADMIN_ITEM_SORT_COLUMN_IDS,
	parseAdminItemFilters,
	type AdminItemColumnId,
	type AdminItemFilter,
	type AdminItemSortColumnId,
} from "./item-list-contract";
import { createParser, parseAsString, parseAsStringLiteral, type inferParserType } from "nuqs/server";

import type { AdminItemViewFilters } from "./types";

export const DEFAULT_ADMIN_ITEM_VIEW_FILTERS: AdminItemViewFilters = {
	reviewQueue: false,
	filters: [],
	query: "",
	sort: "updated",
	sortDirection: "desc",
};

/** The longest record search the library reads. The search field takes no more. */
export const ADMIN_SEARCH_MAX = 500;

/**
 * The address parameters that hold the record view, as nuqs reads and writes them. A parameter that does not parse
 * (a stale `filters` value, an unknown sort) reads as its default and leaves the others standing.
 */
export const adminItemViewParsers = {
	review: parseAsStringLiteral(["pending"] as const),
	filters: createParser<AdminItemFilter[]>({
		parse(value) {
			try {
				return parseAdminItemFilters(JSON.parse(value));
			} catch {
				return null;
			}
		},
		serialize: (value) => JSON.stringify(value),
		eq: (a, b) => JSON.stringify(a) === JSON.stringify(b),
	}).withDefault([]),
	search: parseAsString.withDefault(""),
	sort: parseAsStringLiteral(ADMIN_ITEM_SORT_COLUMN_IDS).withDefault(DEFAULT_ADMIN_ITEM_VIEW_FILTERS.sort),
	direction: parseAsStringLiteral(["asc", "desc"] as const).withDefault(DEFAULT_ADMIN_ITEM_VIEW_FILTERS.sortDirection),
};
type AdminItemViewParams = inferParserType<typeof adminItemViewParsers>;

/** The record view the address parameters describe. */
export function viewFromParams(params: AdminItemViewParams): AdminItemViewFilters {
	return {
		reviewQueue: params.review === "pending",
		filters: params.filters,
		// As typed: trimming here would take a space away while the next word is on its way.
		query: params.search.slice(0, ADMIN_SEARCH_MAX),
		sort: params.sort,
		sortDirection: params.direction,
	};
}

/** The address parameters for a record view. */
export function paramsFromView(view: AdminItemViewFilters): AdminItemViewParams {
	return {
		review: view.reviewQueue ? "pending" : null,
		filters: view.filters,
		search: view.query,
		sort: view.sort,
		direction: view.sortDirection,
	};
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
