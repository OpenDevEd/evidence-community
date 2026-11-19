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
	// Rank by meaning (the index's embedder) instead of matching words.
	meaning: parseAsBoolean.withDefault(false),
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

/** Every record has some meaning score, so a search by meaning lists only this many of the closest. */
export const MEANING_RESULT_LIMIT = 50;

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
