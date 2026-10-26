import type { estypes } from "@elastic/elasticsearch";

import { INSTITUTION_FILTER_FIELD } from "@/config/library-config/institutions";
import { FULL_TEXT_PDF_PRESENCE_ATTRIBUTE, SOURCES_FIELD, TITLE_START_WORDS } from "./search-filter-constants";

/**
 * Public search on a library's Elasticsearch index (OpenDevEd/new-el#721): filters, the text query, sorting, facet
 * counts, and the cursor that pages past the first 10,000 results.
 */

export type SearchFilter = estypes.QueryDslQueryContainer;

/** One facet's values and how many results have each. */
export type CategoriesDistribution = Record<string, number>;

/** Facet counts as readers' filters show them: for each facet, each value and how many results have it. */
export type FacetDistribution = Record<string, CategoriesDistribution>;

/** Values each facet can count, as many as a filter lists. */
const FACET_VALUES = 10_000;

/** Facets listed by how many results have each value; the rest are listed by value. */
const COUNT_ORDERED_FACETS = new Set([
	"collectionsAncestry",
	"country",
	"authorCountry",
	SOURCES_FIELD,
	"topicAncestors",
	"studyType",
	"studyTypeShown",
	"fullNames",
	INSTITUTION_FILTER_FIELD,
]);

/** Fields readers filter on whole and also search as words: the words are in `<field>.text`. */
const SEARCHED_WHOLE_FIELDS = new Set(["tags", "fullNames"]);

/** Sort options that sort on another field than the attribute they name. */
const SORT_FIELDS: Readonly<Record<string, string>> = { title: "title.sort" };

export function fieldEquals(field: string, value: string | number | boolean): SearchFilter {
	return { term: { [field]: value } };
}

export function fieldIn(field: string, values: readonly (string | number)[]): SearchFilter {
	return { terms: { [field]: [...values] } };
}

export function fieldNotIn(field: string, values: readonly (string | number)[]): SearchFilter {
	return { bool: { must_not: [fieldIn(field, values)] } };
}

export function fieldNotEquals(field: string, value: string | number | boolean): SearchFilter {
	return { bool: { must_not: [fieldEquals(field, value)] } };
}

export function fieldPresent(field: string): SearchFilter {
	return { exists: { field } };
}

/** Records with PDF page text. */
export const HAS_PDF_TEXT: SearchFilter = fieldPresent(FULL_TEXT_PDF_PRESENCE_ATTRIBUTE);

function year(value: string | undefined) {
	const parsed = value ? Number(value) : Number.NaN;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** A year range from the `range` param, `2015`, `2015-2020`, `2015-` or `-2020`; null when it names no year. */
export function yearRange(range: string | null): SearchFilter | null {
	if (!range) return null;
	const [start, end] = range.includes("-") ? range.split("-") : [range, range];
	const [from, to] = [year(start), year(end)];
	if (from !== null && from === to) return fieldEquals("year", from);
	if (from === null && to === null) return null;
	return { range: { year: { ...(from === null ? {} : { gte: from }), ...(to === null ? {} : { lte: to }) } } };
}

/** The field a search attribute is read from: whole-value fields keep their words in `.text`. */
function textField(attribute: string) {
	return SEARCHED_WHOLE_FIELDS.has(attribute) ? `${attribute}.text` : attribute;
}

/** Meilisearch searched the first ten words of a search and ignored the rest. */
const SEARCHED_WORDS = 10;

/** Meilisearch's typo rule: one typo from five letters, two from nine. None on a word's first letter keeps it fast. */
const TYPOS = { fuzziness: "AUTO:5,9", prefix_length: 1 };

function inAnyField(query: string, fields: string[], options: object = {}): SearchFilter {
	return { multi_match: { query, fields, operator: "and", ...options } };
}

function eitherOf(left: SearchFilter, right: SearchFilter): SearchFilter {
	return { bool: { should: [left, right], minimum_should_match: 1 } };
}

function scored(filter: SearchFilter, boost: number): SearchFilter {
	return { constant_score: { filter, boost } };
}

/** The start of a longer word, which the last word of a search may be while it is still being typed. */
function startOfWord(word: string, fields: string[]): SearchFilter {
	return { multi_match: { query: word, fields, type: "phrase_prefix" } };
}

/** A word in any of the fields, as typed. */
function wordAsTyped(word: string, fields: string[], last: boolean) {
	const typed = inAnyField(word, fields);
	return last ? eitherOf(typed, startOfWord(word, fields)) : typed;
}

/** A word in any of the fields, allowing typos. */
function wordFound(word: string, fields: string[], last: boolean) {
	const typos = inAnyField(word, fields, TYPOS);
	return last ? eitherOf(typos, startOfWord(word, fields)) : typos;
}

/** Words a search may hold that are one indexed term, which a typo rule can match: no separators, and spaces between words. */
const ONE_TERM = /^[\p{L}\p{M}\p{N}]+$/u;
const UNSPACED_SCRIPTS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** Shorter prefixes can name more words than Elasticsearch expands in an interval rule, which fails the search. */
const SHORTEST_INTERVAL_PREFIX = 4;

/** A word as an interval rule: allowing typos where it is one term, and for the last word, as the start of a longer one. */
function wordInterval(word: string, last: boolean): estypes.QueryDslIntervalsContainer {
	const oneTerm = ONE_TERM.test(word) && !UNSPACED_SCRIPTS.test(word);
	const typed: estypes.QueryDslIntervalsContainer = oneTerm
		? { fuzzy: { term: word, ...TYPOS } }
		: { match: { query: word, ordered: true, max_gaps: 0 } };
	return last && oneTerm && word.length >= SHORTEST_INTERVAL_PREFIX ? { any_of: { intervals: [typed, { prefix: { prefix: word } }] } } : typed;
}

/** Every one of the first words at the start of the title, typos allowed. */
function titleStart(words: readonly string[], last: number): SearchFilter {
	const rules = words.slice(0, TITLE_START_WORDS).map((word, index) => wordInterval(word, index === last));
	return { intervals: { "title.start": rules.length === 1 ? rules[0]! : { all_of: { ordered: false, max_gaps: -1, intervals: rules } } } };
}

/**
 * The text part of a search, matching and ranking as Meilisearch's default rules did, in their order. A record needs
 * the first word, typos allowed. Then it ranks higher with more of the other words (words), more words as typed
 * (typo), the words as a phrase or close together (proximity), and every word in an earlier field (attributeRank).
 * Without a chosen order, it then ranks higher with the words at the start of the title (wordPosition), and highest
 * when its title is the search (exactness); Meilisearch ranked those after a chosen order. Each rule scores more than
 * every rule after it together, so the rules apply in turn.
 */
export function textQuery(text: string, attributes: readonly string[], options: { sorted?: boolean } = {}): SearchFilter | null {
	const words = text.trim().split(/\s+/u).filter(Boolean).slice(0, SEARCHED_WORDS);
	if (!words.length) return null;
	const query = words.join(" ");
	const fields = attributes.map(textField);
	const last = words.length - 1;
	const byTitle = attributes.includes("title") && options.sorted !== true;
	return {
		bool: {
			filter: [wordFound(words[0]!, fields, last === 0)],
			should: [
				...words.slice(1).map((word, index) => scored(wordFound(word, fields, index + 1 === last), 10_000)),
				...words.map((word, index) => scored(wordAsTyped(word, fields, index === last), 1_000)),
				...(words.length > 1
					? [{ dis_max: { queries: [scored({ multi_match: { query, fields, type: "phrase" } }, 300), scored({ multi_match: { query, fields, type: "phrase", slop: 3 } }, 200)] } }]
					: []),
				{ dis_max: { queries: fields.map((field, index) => scored({ match: { [field]: { query, operator: "and" } } }, 10 * Math.max(1, 9 - index))) } },
				...(byTitle ? [scored(titleStart(words, last), 5), { term: { "title.sort": { value: query, boost: 2 } } }] : []),
			],
		},
	};
}

/**
 * The sort clauses for a sort option (`field:asc` entries; none for relevance). With search text, results rank by
 * relevance first and a chosen order sorts each tie, as Meilisearch's ranking rules put its sort after relevance.
 * Every sort ends on the record key, so records that tie keep one order and a cursor can continue after any of them.
 */
export function sortClauses(sort: readonly string[] | undefined, options: { text?: string; reverse?: boolean } = {}): estypes.SortCombinations[] {
	const reverse = options.reverse === true;
	const flip = (order: "asc" | "desc") => (reverse ? (order === "asc" ? "desc" : "asc") : order);
	const fields = (sort ?? []).map((entry) => {
		const [field, order] = entry.split(":") as [string, "asc" | "desc"];
		return { [SORT_FIELDS[field] ?? field]: { order: flip(order), missing: reverse ? "_first" : "_last", ...(field === "fullNames" ? { mode: order === "asc" ? "min" : "max" } : {}) } } as estypes.SortCombinations;
	});
	const relevance: estypes.SortCombinations[] = options.text?.trim() ? [{ _score: { order: flip("desc") } }] : [];
	return [...relevance, ...fields, { key: { order: flip("asc") } }];
}

/** Counts for each facet, in the order readers see them. */
export function facetAggregations(facets: readonly string[]): Record<string, estypes.AggregationsAggregationContainer> {
	return Object.fromEntries(
		facets.map((facet) => [
			facet,
			{ terms: { field: facet, size: FACET_VALUES, order: COUNT_ORDERED_FACETS.has(facet) ? { _count: "desc" } : { _key: "asc" } } },
		]),
	);
}

type TermsBuckets = { buckets?: Array<{ key: string | number; key_as_string?: string; doc_count: number }> };

/** The facet counts an answer's aggregations hold. */
export function facetDistribution(aggregations: Record<string, unknown> | undefined): FacetDistribution {
	return Object.fromEntries(
		Object.entries(aggregations ?? {}).map(([facet, result]) => [
			facet,
			Object.fromEntries(((result as TermsBuckets).buckets ?? []).map((bucket) => [bucket.key_as_string ?? String(bucket.key), bucket.doc_count])),
		]),
	);
}

/**
 * A search's filters and text as one query; every filter must hold, and the text decides the order. With a chosen
 * order (`sort`), the text ranks only by the rules Meilisearch put before it.
 */
export function searchQuery(text: string, attributes: readonly string[], filters: readonly SearchFilter[], sort?: readonly string[]): SearchFilter {
	const matching = textQuery(text, attributes, { sorted: Boolean(sort?.length) });
	return { bool: { ...(matching ? { must: [matching] } : {}), filter: [...filters] } };
}

type Cursor = { order: string; values: estypes.FieldValue[] };

/** A short name for an order of results (FNV-1a of its sort clauses), which a cursor carries. */
function orderName(order: readonly estypes.SortCombinations[]) {
	let hash = 0x811c9dc5;
	for (const character of JSON.stringify(order)) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
	return (hash >>> 0).toString(36);
}

/**
 * Where a page continues from, written for a URL: the sort values of the record next to it, and the order they
 * belong to, since they place a record only in that order.
 */
export function encodeCursor(order: readonly estypes.SortCombinations[], sortValues: readonly estypes.FieldValue[] | undefined) {
	if (!sortValues) return null;
	const cursor: Cursor = { order: orderName(order), values: [...sortValues] };
	return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function isFieldValue(value: unknown) {
	return value === null || ["string", "number", "boolean"].includes(typeof value);
}

/** The sort values a cursor holds, or null when it is no cursor for this order. */
export function decodeCursor(cursor: string | null | undefined, order: readonly estypes.SortCombinations[]): estypes.FieldValue[] | null {
	if (!cursor) return null;
	try {
		const read = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<Cursor>;
		const values = Array.isArray(read.values) ? read.values : [];
		return read.order === orderName(order) && values.length === order.length && values.every(isFieldValue) ? values : null;
	} catch {
		return null;
	}
}
