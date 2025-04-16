import { SCOPE_OPTIONS } from '@/constants/items';
import { SORT_OPTIONS } from '@/constants/items';
import { createLoader, parseAsArrayOf, parseAsString, parseAsInteger, createSerializer } from 'nuqs/server';

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
	scope: parseAsString.withDefault(SCOPE_OPTIONS[0].key),
	range: parseAsString.withDefault(""),
	collectionId: parseAsString.withDefault("").withOptions({
		scroll: true,
	}),
	institution: parseAsArrayOf(parseAsString).withDefault([]),
	country: parseAsArrayOf(parseAsString).withDefault([]),
	author_country: parseAsArrayOf(parseAsString).withDefault([]),
	author: parseAsString.withDefault("").withOptions({
		scroll: true,
	}),
	
}

export const serializeSearchParams = createSerializer(searchParamsLoader);

export const loadSearchParams = createLoader(searchParamsLoader);