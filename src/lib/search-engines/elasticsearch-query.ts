import type { estypes } from "@elastic/elasticsearch";

import { INSTITUTION_FILTER_FIELD } from "@/config/library-config/institutions";
import type { FacetDistribution, SearchFilter } from "@/lib/search-engine";
import { FULL_TEXT_PDF_ATTRIBUTE, SOURCES_FIELD, TITLE_START_WORDS } from "@/lib/search-filter-constants";
import { FOLDED_KEYWORD_FIELDS, SEARCHED_KEYWORD_FIELDS } from "@/lib/search-index/elasticsearch-index";

/**
 * A search request as Elasticsearch runs it (OpenDevEd/new-el#721): filters as query clauses, the text query ranked as
 * Meilisearch ranked, sorting, and facet counts.
 */

type Query = estypes.QueryDslQueryContainer;

/** A filter as an Elasticsearch query clause. */
export function filterClause(filter: SearchFilter): Query {
	if ("any" in filter) return { bool: { should: filter.any.map(filterClause), minimum_should_match: 1 } };
	if ("not" in filter) return { bool: { must_not: [filterClause(filter.not)] } };
	if ("equals" in filter) return { term: { [filter.field]: filter.equals } };
	if ("in" in filter) return { terms: { [filter.field]: [...filter.in] } };
	if ("present" in filter) return { exists: { field: filter.field } };
	return { range: { [filter.field]: filter.range } };
}

/** Values each facet can count, as many as a filter lists. */
const FACET_VALUES = 10_000;
/** Names the aggregation that counts a limited facet's values. */
const DISTINCT = "distinct:";

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


/** Sort options that sort on another field than the attribute they name. */
const SORT_FIELDS: Readonly<Record<string, string>> = { title: "title.sort" };

/** The field a search attribute is read from: whole-value fields keep their words in `.text`. */
function textField(attribute: string) {
	return SEARCHED_KEYWORD_FIELDS.includes(attribute) ? `${attribute}.text` : attribute;
}

/** A hundredth of a BM25 score. AIED's highest was 21, for a ten-word question, so this stays below the smallest rule's 2 points. */
const TIE_BREAK = 0.01;

/** Meilisearch searched the first ten words of a search and ignored the rest. */
const SEARCHED_WORDS = 10;

/** Meilisearch's typo rule: one typo from five letters, two from nine. None on a word's first letter keeps it fast. */
const TYPOS = { fuzziness: "AUTO:5,9", prefix_length: 1 };

function inAnyField(query: string, fields: string[], options: object = {}): Query {
	return { multi_match: { query, fields, operator: "and", ...options } };
}

function eitherOf(left: Query, right: Query): Query {
	return { bool: { should: [left, right], minimum_should_match: 1 } };
}

function scored(filter: Query, boost: number): Query {
	return { constant_score: { filter, boost } };
}

/**
 * The start of a longer word, which the last word of a search may be while it is still being typed. Every word with
 * that start matches, as in Meilisearch; a phrase prefix would match only the first 50.
 */
function startOfWord(word: string, fields: string[]): Query {
	return { multi_match: { query: word, fields, type: "bool_prefix", operator: "and" } };
}

/** A word in any of the fields, as typed. */
function wordAsTyped(word: string, fields: string[], last: boolean) {
	const typed = inAnyField(word, fields);
	return last ? eitherOf(typed, startOfWord(word, fields)) : typed;
}

/** Every word in one field as typed, the last also as the start of a longer word. */
function everyWordIn(field: string, words: readonly string[], last: number): Query {
	return { bool: { filter: words.map((word, index) => wordAsTyped(word, [field], index === last)) } };
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

/**
 * The fields whose whole value can be the search, lowercased and without accents: the title, as in Meilisearch, and a
 * metadata value when only metadata is searched, where a reader looks for a journal, publisher or institution by name.
 * Beside the full text, a value that names a topic (the journal Machine Learning) says little about a paper.
 */
function exactValueFields(attributes: readonly string[]) {
	const byMetadata = attributes.includes("metadataSearch") && !attributes.includes(FULL_TEXT_PDF_ATTRIBUTE);
	return [...(attributes.includes("title") ? ["title.sort"] : []), ...(byMetadata ? ["metadataSearch.exact"] : [])];
}

/** A record with a whole value that is the search, such as its title or its journal's name. */
function exactValue(attributes: readonly string[], typed: readonly string[]): Query[] {
	const fields = exactValueFields(attributes);
	return fields.length ? [{ dis_max: { queries: fields.map((field) => ({ term: { [field]: { value: typed.join(" "), boost: 2 } } })) } }] : [];
}

/** Every one of the first words at the start of the title, typos allowed. */
function titleStart(words: readonly string[], last: number): Query {
	const rules = words.slice(0, TITLE_START_WORDS).map((word, index) => wordInterval(word, index === last));
	return { intervals: { "title.start": rules.length === 1 ? rules[0]! : { all_of: { ordered: false, max_gaps: -1, intervals: rules } } } };
}

/**
 * The text part of a search, matching and ranking as Meilisearch's default rules did, in their order. A record needs
 * the first word, typos allowed. Then it ranks higher with more of the other words (words), more words as typed
 * (typo), the words as a phrase or close together (proximity), and every word in an earlier field (attributeRank).
 * Without a chosen order, it then ranks higher with the words at the start of the title (wordPosition), and when its
 * title, or in a metadata search a journal or other value, is the search (exactness); Meilisearch ranked those
 * after a chosen order. Each rule scores more than every rule after it together, so the rules apply in turn. Records
 * the rules tie are last ordered by Elasticsearch's own relevance, which Meilisearch's position rules stood in for.
 */
export function textQuery(text: string, attributes: readonly string[], options: { sorted?: boolean } = {}): Query | null {
	const typed = text.trim().split(/\s+/u).filter(Boolean).slice(0, SEARCHED_WORDS);
	// A word of only punctuation, like `&` or `-`, has no letter to find; Meilisearch read it as a separator.
	const words = typed.filter((word) => /[\p{L}\p{N}]/u.test(word));
	if (!words.length) return null;
	const query = words.join(" ");
	const fields = attributes.map(textField);
	const last = words.length - 1;
	const ranked = options.sorted !== true;
	const byTitle = attributes.includes("title") && ranked;
	return {
		bool: {
			filter: [wordFound(words[0]!, fields, last === 0)],
			should: [
				...words.slice(1).map((word, index) => scored(wordFound(word, fields, index + 1 === last), 10_000)),
				...words.map((word, index) => scored(wordAsTyped(word, fields, index === last), 1_000)),
				...(words.length > 1
					? [{ dis_max: { queries: [scored({ multi_match: { query, fields, type: "phrase" } }, 300), scored({ multi_match: { query, fields, type: "phrase", slop: 3 } }, 200)] } }]
					: []),
				{ dis_max: { queries: fields.map((field, index) => scored(everyWordIn(field, words, last), 10 * Math.max(1, 9 - index))) } },
				...(byTitle ? [scored(titleStart(words, last), 5)] : []),
				...(ranked ? exactValue(attributes, typed) : []),
				// Records the rules give the same points are ordered by Elasticsearch's own relevance (BM25): how often the
				// words occur against the field's length, and how rare they are. Scaled to stay below the smallest rule.
				...(ranked ? [{ multi_match: { query, fields, boost: TIE_BREAK } }] : []),
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

/**
 * Counts for each facet, in the order readers see them. Tags, names and institutions count ignoring case and accents,
 * as Meilisearch counted them; each value is named as most of its records spell it.
 */
export function facetAggregations(facets: readonly string[], limit?: number): Record<string, estypes.AggregationsAggregationContainer> {
	return Object.fromEntries(
		facets.flatMap((facet) => [
			[
				facet,
				{
					terms: {
						field: facet,
						size: limit ?? FACET_VALUES,
						order: limit !== undefined || COUNT_ORDERED_FACETS.has(facet) ? { _count: "desc" } : { _key: "asc" },
					},
					...(FOLDED_KEYWORD_FIELDS.includes(facet) ? { aggs: { spelling: { terms: { field: `${facet}.raw`, size: 1 } } } } : {}),
				},
			],
			...(limit === undefined ? [] : [[`${DISTINCT}${facet}`, { cardinality: { field: facet } }]]),
		]),
	);
}

type Bucket = { key: string | number; key_as_string?: string; doc_count: number; spelling?: { buckets?: Array<{ key: string }> } };

/** A value's name: as most of its records spell it, else as Elasticsearch keys it (an index from before `.raw`). */
function bucketName(bucket: Bucket) {
	return bucket.spelling?.buckets?.[0]?.key ?? bucket.key_as_string ?? String(bucket.key);
}

/** The facet counts an answer's aggregations hold. */
export function facetDistribution(aggregations: Record<string, unknown> | undefined): FacetDistribution {
	return Object.fromEntries(
		Object.entries(aggregations ?? {}).filter(([facet]) => !facet.startsWith(DISTINCT)).map(([facet, result]) => [
			facet,
			Object.fromEntries(((result as { buckets?: Bucket[] }).buckets ?? []).map((bucket) => [bucketName(bucket), bucket.doc_count])),
		]),
	);
}

/** How many values each limited facet has, from an answer's aggregations. */
export function facetDistinctCounts(aggregations: Record<string, unknown> | undefined) {
	return Object.fromEntries(
		Object.entries(aggregations ?? {})
			.filter(([facet]) => facet.startsWith(DISTINCT))
			.map(([facet, result]) => [facet.slice(DISTINCT.length), (result as { value: number }).value]),
	);
}

/**
 * A search's filters and text as one query; every filter must hold, and the text decides the order. With a chosen
 * order (`sort`), the text ranks only by the rules Meilisearch put before it.
 */
export function searchQuery(text: string, attributes: readonly string[], filters: readonly SearchFilter[], sort?: readonly string[]): Query {
	const matching = textQuery(text, attributes, { sorted: Boolean(sort?.length) });
	return { bool: { ...(matching ? { must: [matching] } : {}), filter: filters.map(filterClause) } };
}
