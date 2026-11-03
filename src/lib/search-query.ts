import type { inferParserType } from "nuqs";
import type { LibraryPublicConfig } from "@/config/library-config/schema";
import {
	getRuntimeSearchScopeOptions,
	normalizeRuntimeYearRange,
	resolveRuntimeSearchScope,
	type RuntimeSearch,
} from "@/config/library-config/search";
import { ITEMS_PER_PAGE, SORT_OPTIONS } from "@/constants/items";
import { COUNTRIES } from "@/constants/misc";
import { findEntryByPath } from "./country";
import { SEARCH_RESULT_LIMIT } from "./search-filter-constants";
import type { searchParamsLoader } from "./searchParams";

export type QueryIssue = { parameter: string; message: string };
export type SearchQueryConfig = {
	filters: LibraryPublicConfig["filters"];
	search: RuntimeSearch;
	topics?: { enabled: boolean };
	/** The server's configuration lists its sources; the public one has already turned the filter off below two. */
	sources?: readonly unknown[];
};
type SearchParams = Partial<inferParserType<typeof searchParamsLoader>>;
/** What the library runs for one param, and what was wrong with what it was given. */
type Resolved<T> = { value: T; issue?: string };

function resolveSort(sort: string | undefined): Resolved<string> {
	const sorts = SORT_OPTIONS.map((option) => option.key);
	if (!sort || sorts.includes(sort)) return { value: sort || SORT_OPTIONS[0].key };
	return {
		value: SORT_OPTIONS[0].key,
		issue: `sort must be one of: ${sorts.join(", ")}.`,
	};
}

function resolveScope(scope: string | undefined, search: RuntimeSearch) {
	const value = resolveRuntimeSearchScope(scope, search);
	if (!scope || scope === value) return { value };
	const scopes = getRuntimeSearchScopeOptions(search).map((option) => option.key);
	return { value, issue: `scope must be one of: ${scopes.join(", ")}.` };
}

function resolveRange(
	range: string | undefined,
	filters: SearchQueryConfig["filters"],
): Resolved<string> {
	const value = normalizeRuntimeYearRange(range, filters);
	if (!range || value) return { value };
	return {
		value,
		issue: filters.years.enabled
			? "range must be a year, or two years in order, such as 2020 or 2020-2024."
			: "This community has no year filter.",
	};
}

/** A filter the library may have switched off: its values, or none and why. */
function resolveOffered(
	values: string[] | undefined,
	offered: boolean,
	filter: string,
): Resolved<string[]> {
	if (offered) return { value: values ?? [] };
	return {
		value: [],
		...(values?.length ? { issue: `This community has no ${filter} filter.` } : {}),
	};
}

/** Readers filter by sources when the library turns it on and has two or more: one source would filter nothing. */
export const offersSources = (config: Pick<SearchQueryConfig, "filters" | "sources">) =>
	config.filters.sources.enabled && (config.sources === undefined || config.sources.length > 1);

/** A country code, or a continent or region as the country filter lists it. */
const isKnownPlace = (place: string) =>
	Object.hasOwn(COUNTRIES, place) || findEntryByPath(place) !== null;

/** The last page that can hold a result, which depends on how many a page holds. */
export const lastReachablePage = (perPage: number) =>
	Math.ceil(SEARCH_RESULT_LIMIT / perPage);

function resolveCountry(
	places: string[] | undefined,
	offered: boolean,
	name = "country",
): Resolved<string[]> {
	const filter = resolveOffered(places, offered, name);
	const unknown = filter.value.filter((place) => !isKnownPlace(place));
	if (unknown.length === 0) return filter;
	return {
		value: filter.value.filter(isKnownPlace),
		issue: `${name} takes two-letter codes such as QA, or a region as the community lists it. Unknown: ${unknown.join(", ")}.`,
	};
}

/**
 * The search this library runs for these params. Whatever it does not offer
 * is put right and named in `issues`. A page ignores them, so an old or
 * mistyped link still opens; the API refuses the request with them.
 */
export function resolveSearchQuery<P extends SearchParams>(
	params: P,
	config: SearchQueryConfig,
	perPage: number = ITEMS_PER_PAGE,
) {
	const page = Number(params.page);
	const resolved = {
		sort: resolveSort(params.sort),
		scope: resolveScope(params.scope, config.search),
		range: resolveRange(params.range, config.filters),
		institution: resolveOffered(
			params.institution,
			config.filters.institution.mode !== "hidden",
			"institution",
		),
		country: resolveCountry(params.country, config.search.country),
		// The authors' countries are offered wherever the country focus is.
		author_country: resolveCountry(params.author_country, config.search.country, "author_country"),
		topics: resolveOffered(
			params.topics,
			Boolean(config.topics?.enabled),
			"topic",
		),
		sources: resolveOffered(params.sources, offersSources(config), "source"),
		study: resolveOffered(params.study, config.filters.studyTypes.enabled, "study type"),
	};
	return {
		params: {
			...params,
			sort: resolved.sort.value,
			scope: resolved.scope.value,
			range: resolved.range.value,
			institution: resolved.institution.value,
			country: resolved.country.value,
			author_country: resolved.author_country.value,
			topics: resolved.topics.value,
			sources: resolved.sources.value,
			study: resolved.study.value,
			// A page that cannot hold a result opens on the first.
			page:
				Number.isInteger(page) && page >= 1 && page <= lastReachablePage(perPage)
					? page
					: 1,
		},
		issues: Object.entries(resolved).flatMap(
			([parameter, { issue }]): QueryIssue[] =>
				issue ? [{ parameter, message: issue }] : [],
		),
	};
}
