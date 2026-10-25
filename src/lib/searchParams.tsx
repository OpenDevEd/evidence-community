import { SORT_OPTIONS } from "@/constants/items";
import {
	createLoader,
	parseAsArrayOf,
	parseAsString,
	parseAsInteger,
	createSerializer,
	type inferParserType,
} from "nuqs/server";

export const searchParamsLoader = {
	collections: parseAsArrayOf(parseAsString).withDefault([]).withOptions({
		scroll: true,
	}),
	referrer: parseAsString.withDefault("").withOptions({
		scroll: true,
	}),
	page: parseAsInteger.withDefault(1).withOptions({
		scroll: true,
	}),
	sort: parseAsString.withDefault(SORT_OPTIONS[0].key),
	search: parseAsString.withDefault(""),
	scope: parseAsString.withDefault(""),
	range: parseAsString.withDefault(""),
	collectionId: parseAsString.withDefault("").withOptions({
		scroll: true,
	}),
	institution: parseAsArrayOf(parseAsString).withDefault([]).withOptions({
		scroll: true,
	}),
	country: parseAsArrayOf(parseAsString).withDefault([]).withOptions({
		scroll: true,
	}),
	/** Countries of the authors' affiliations, as the country filter's places are written. */
	author_country: parseAsArrayOf(parseAsString).withDefault([]).withOptions({
		scroll: true,
	}),
	topics: parseAsArrayOf(parseAsString).withDefault([]).withOptions({
		scroll: true,
	}),
	/** The library's sources, any of them, by key. */
	sources: parseAsArrayOf(parseAsString).withDefault([]).withOptions({
		scroll: true,
	}),
	author: parseAsString.withDefault("").withOptions({
		scroll: true,
	}),
	type: parseAsArrayOf(parseAsString).withDefault([]).withOptions({
		scroll: true,
	}),
	/** Study types, any of them, as Jev read each record. */
	study: parseAsArrayOf(parseAsString).withDefault([]).withOptions({
		scroll: true,
	}),
	/** Tag filters' ticks as `<filter>:<tag>`; a filter not named here has its defaults ticked. See `tag-filters.ts`. */
	tags: parseAsArrayOf(parseAsString).withDefault([]).withOptions({
		scroll: true,
	}),
	/** Whether ticked collections match `any` or `all`; empty is the library's choice. */
	match: parseAsString.withDefault(""),
	error: parseAsString.withDefault(""),
	message: parseAsString.withDefault(""),
};

export const serializeSearchParams = createSerializer(searchParamsLoader);

export const loadSearchParams = createLoader(searchParamsLoader);

type SearchParams = inferParserType<typeof searchParamsLoader>;

/** What a reader narrows results by: Clear filters empties these and the filter chips count them, so a new filter goes here. */
const FILTER_PARAMS = ["range", "institution", "country", "author_country", "author", "collections", "topics", "sources", "type", "study", "tags", "match"] as const;
export const RESULT_PARAMS = ["search", "scope", ...FILTER_PARAMS] as const;
/** The params that never change which results come back. */
const OTHER_PARAMS = ["referrer", "page", "sort", "collectionId", "error", "message"] as const;
type Unsorted = Exclude<keyof SearchParams, (typeof RESULT_PARAMS)[number] | (typeof OTHER_PARAMS)[number]>;
// A param in neither list stops this compiling, and the error says where it goes.
const everyParamSorted: [Unsorted] extends [never] ? true : `Add ${Unsorted} to FILTER_PARAMS or OTHER_PARAMS in searchParams.tsx` = true;

/** Every filter emptied, as Clear filters sets them. */
export const NO_FILTERS = Object.fromEntries(FILTER_PARAMS.map((key) => [key, null])) as Record<(typeof FILTER_PARAMS)[number], null>;

/** How many filters a reader chose: one per value ticked, and one for each single-value filter that is set. */
export function chosenFilterCount(params: Pick<SearchParams, (typeof FILTER_PARAMS)[number]>) {
	return FILTER_PARAMS.reduce((count, key) => {
		const value = params[key];
		return count + (Array.isArray(value) ? value.length : value ? 1 : 0);
	}, 0);
}

/** The params that decide which results a search returns, so a cache keyed on them ignores page, order and where the reader came from. */
export function resultParams(params: SearchParams) {
	return Object.fromEntries(RESULT_PARAMS.map((key) => [key, params[key]])) as Pick<SearchParams, (typeof RESULT_PARAMS)[number]>;
}

/** What a results list is asked for: the results, their order and the page. Where the reader came from and page notices stay on the page. */
export function listingParams(params: SearchParams) {
	return { ...resultParams(params), sort: params.sort, page: params.page };
}
