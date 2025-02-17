import { SCOPE_OPTIONS } from '@/constants/items';
import { SORT_OPTIONS } from '@/constants/items';
import { createLoader, parseAsArrayOf, parseAsString, parseAsInteger, createSerializer } from 'nuqs/server';

export const searchParamsLoader = {
    collections: parseAsArrayOf(parseAsString).withDefault([]),
	page: parseAsInteger.withDefault(1),
	sort: parseAsString.withDefault(SORT_OPTIONS[0].key),
	search: parseAsString.withDefault(""),
	scope: parseAsString.withDefault(SCOPE_OPTIONS[0].key),
	range: parseAsString.withDefault(""),
	collectionId: parseAsString.withDefault(""),
	institution: parseAsString.withDefault(""),
	author: parseAsString.withDefault(""),
}

export const serializeSearchParams = createSerializer(searchParamsLoader);

export const loadSearchParams = createLoader(searchParamsLoader);