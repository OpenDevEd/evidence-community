import type { LibraryPublicConfig } from "@/config/library-config/schema";
import { chosenFilterCount } from "@/lib/searchParams";

export type TagFilter = LibraryPublicConfig["filters"]["tagFilters"][number];
export type TagSelections = Record<string, string[]>;

/** The address's mark for a filter a reader emptied, so its defaults don't come back. */
const NONE = "*";
/** A `tags` value alone that asks for the whole library: every filter empty, no defaults. Whole-library counts send it. */
export const WHOLE_LIBRARY_TAGS = ["*"];
const SEPARATOR = ":";

const enabledFilters = (filters: readonly TagFilter[]) => filters.filter((filter) => filter.enabled);

/**
 * Each tag filter's ticks, from the `tags` param (`<filter>:<tag>`, or `<filter>:*` for none). A filter the address
 * says nothing about has its defaults ticked.
 */
export function tagSelections(param: readonly string[] | undefined, filters: readonly TagFilter[]): TagSelections {
	if (param?.includes(NONE)) return Object.fromEntries(enabledFilters(filters).map((filter) => [filter.id, []]));
	const entries = (param ?? []).map((entry) => {
		const at = entry.indexOf(SEPARATOR);
		// An entry with no filter or no tag names nothing, so it changes nothing.
		return at > 0 && at < entry.length - 1 ? ([entry.slice(0, at), entry.slice(at + 1)] as const) : null;
	});
	return Object.fromEntries(
		enabledFilters(filters).map((filter) => {
			const own = entries.filter((entry) => entry?.[0] === filter.id).map((entry) => entry![1]);
			return [filter.id, own.length === 0 ? [...filter.defaults] : own.filter((tag) => tag !== NONE)];
		}),
	);
}

const sameTags = (left: readonly string[], right: readonly string[]) =>
	left.length === right.length && left.every((tag) => right.includes(tag));

/** The `tags` param for these ticks: a filter left at its defaults says nothing, so defaults never show in the address. */
export function tagParam(selections: TagSelections, filters: readonly TagFilter[]): string[] {
	return enabledFilters(filters).flatMap((filter) => {
		const ticked = selections[filter.id] ?? [];
		if (sameTags(ticked, filter.defaults)) return [];
		return ticked.length === 0 ? [`${filter.id}${SEPARATOR}${NONE}`] : ticked.map((tag) => `${filter.id}${SEPARATOR}${tag}`);
	});
}

/** Whether every filter is at its defaults, so there is nothing for Clear filters to put back. */
function atDefaults(selections: TagSelections, filters: readonly TagFilter[]) {
	return tagParam(selections, filters).length === 0;
}

/** The tag filters' chips: every tag ticked, defaults too, and each filter whose defaults the reader emptied. */
export function tagFilterChips(selections: TagSelections, filters: readonly TagFilter[]) {
	const enabled = enabledFilters(filters);
	return {
		ticked: enabled.flatMap((filter) => (selections[filter.id] ?? []).map((tag) => ({ filter, tag }))),
		emptied: enabled.filter((filter) => filter.defaults.length > 0 && (selections[filter.id] ?? []).length === 0),
	};
}

/**
 * Whether the filter row has a chip: a filter the reader chose, or a tag filter's chip. The address names only the tag ticks
 * that differ from the defaults; while every filter is at its defaults, its ticks are chips too.
 */
export function showsFilterChips(params: Parameters<typeof chosenFilterCount>[0], filters: readonly TagFilter[]) {
	const selections = tagSelections(params.tags, filters);
	const { ticked, emptied } = tagFilterChips(selections, filters);
	return chosenFilterCount(params) > 0 || (atDefaults(selections, filters) && ticked.length > 0) || emptied.length > 0;
}

/** What a reader sees for a tag: its own label, else its prefix's tag without the prefix, else the tag. */
export function tagLabel(filter: TagFilter, tag: string) {
	const named = filter.options.find((option) => !option.prefix && option.value === tag && option.label);
	if (named?.label) return named.label;
	const prefix = filter.options.find((option) => option.prefix && tag.startsWith(option.value));
	return prefix ? tag.slice(prefix.value.length).trim() || tag : tag;
}

export type TagFilterOption = { tag: string; label: string; count: number };

/**
 * A filter's options in the owner's order, a prefix's tags by count in its place, with each one's count. Options
 * with no records are left out unless ticked.
 */
export function tagFilterOptions(filter: TagFilter, counts: Record<string, number> | undefined, ticked: readonly string[]): TagFilterOption[] {
	const seen = new Set<string>();
	const named = new Set(filter.options.filter((option) => !option.prefix).map((option) => option.value));
	const rows: TagFilterOption[] = [];
	const add = (tag: string) => {
		if (seen.has(tag)) return;
		seen.add(tag);
		const count = counts?.[tag] ?? 0;
		if (count > 0 || ticked.includes(tag)) rows.push({ tag, label: tagLabel(filter, tag), count });
	};
	for (const option of filter.options) {
		if (!option.prefix) {
			add(option.value);
			continue;
		}
		Object.entries(counts ?? {})
			// A tag the owner named keeps its own place.
			.filter(([tag]) => tag.startsWith(option.value) && !named.has(tag))
			.sort((left, right) => right[1] - left[1])
			.forEach(([tag]) => add(tag));
	}
	for (const tag of ticked) add(tag);
	return rows;
}

/** Whether a tag belongs to a filter, by name or by prefix. */
export function inTagFilter(filter: TagFilter, tag: string) {
	return filter.options.some((option) => (option.prefix ? tag.startsWith(option.value) : option.value === tag));
}

/** The facet key a filter's own counts come back under. */
export const tagFacetKey = (id: string) => `tagFilter:${id}`;
