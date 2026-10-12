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
	topics: parseAsArrayOf(parseAsString).withDefault([]).withOptions({
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
	error: parseAsString.withDefault(""),
	message: parseAsString.withDefault(""),
};

export const serializeSearchParams = createSerializer(searchParamsLoader);

export const loadSearchParams = createLoader(searchParamsLoader);

type SearchParams = inferParserType<typeof searchParamsLoader>;
export const RESULT_PARAMS = ["search", "scope", "range", "institution", "country", "author", "collections", "topics", "type", "study"] as const;

/** The params that decide which results a search returns, so a cache keyed on them ignores page, order and where the reader came from. */
export function resultParams(params: SearchParams) {
	return Object.fromEntries(RESULT_PARAMS.map((key) => [key, params[key]])) as Pick<SearchParams, (typeof RESULT_PARAMS)[number]>;
}

/** What a results list is asked for: the results, their order and the page. Where the reader came from and page notices stay on the page. */
export function listingParams(params: SearchParams) {
	return { ...resultParams(params), sort: params.sort, page: params.page };
}
