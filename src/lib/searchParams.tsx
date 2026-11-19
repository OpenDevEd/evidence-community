import { SCOPE_OPTIONS } from '@/constants/items';
import { SORT_OPTIONS } from '@/constants/items';
import { createLoader, parseAsArrayOf, parseAsBoolean, parseAsString, parseAsInteger, createSerializer } from 'nuqs/server';

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
	// Mock: which of the five meaning concepts runs (src/lib/semantic-concepts.ts).
	concept: parseAsInteger.withDefault(1),
	// More like this: the record the list is built around.
	like: parseAsString.withDefault(""),
	// Themes: the chosen theme, -1 for all.
	theme: parseAsInteger.withDefault(-1),
	// Understood query: search the words as typed.
	literal: parseAsBoolean.withDefault(false),
	// Blended: hide the results found by meaning alone.
	wordsOnly: parseAsBoolean.withDefault(false),
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
	author_country: parseAsArrayOf(parseAsString).withDefault([]).withOptions({
		scroll: true,
	}),
	author: parseAsString.withDefault("").withOptions({
		scroll: true,
	}),
	error: parseAsString.withDefault(""),
	message: parseAsString.withDefault(""),
}

export const serializeSearchParams = createSerializer(searchParamsLoader);

export const loadSearchParams = createLoader(searchParamsLoader);
/**
 * A `range` param carries a year filter only once it contains a year; a bare
 * "-" is just range mode with nothing picked yet and must not count as a
 * filter or render a chip.
 */
export function hasYearConstraint(range: string | undefined | null) {
	return /\d/.test(range ?? "");
}
