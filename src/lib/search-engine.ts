import type { SearchEngineName } from "@/config/library-config/schema";

import { FULL_TEXT_PDF_PRESENCE_ATTRIBUTE } from "./search-filter-constants";

/**
 * A library's search in terms of no engine in particular (OpenDevEd/new-el#721, #722): the filters a search holds,
 * what a page asks for, what comes back, and the cursor that continues past the numbered pages. Each engine's adapter
 * in `src/lib/search-engines/` turns them into its own query.
 */

type FilterValue = string | number | boolean;

/** A condition a record must meet. */
export type SearchFilter =
	| { field: string; equals: FilterValue }
	| { field: string; in: readonly (string | number)[] }
	| { field: string; present: true }
	| { field: string; range: { gte?: number; lte?: number } }
	| { not: SearchFilter }
	| { any: readonly SearchFilter[] };

export function fieldEquals(field: string, value: FilterValue): SearchFilter {
	return { field, equals: value };
}

export function fieldIn(field: string, values: readonly (string | number)[]): SearchFilter {
	return { field, in: [...values] };
}

export function fieldNotIn(field: string, values: readonly (string | number)[]): SearchFilter {
	return { not: fieldIn(field, values) };
}

export function fieldNotEquals(field: string, value: FilterValue): SearchFilter {
	return { not: fieldEquals(field, value) };
}

export function fieldPresent(field: string): SearchFilter {
	return { field, present: true };
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
	return { field: "year", range: { ...(from === null ? {} : { gte: from }), ...(to === null ? {} : { lte: to }) } };
}

/** One facet's values and how many results have each. */
export type CategoriesDistribution = Record<string, number>;

/** Facet counts as readers' filters show them: for each facet, each value and how many results have it. */
export type FacetDistribution = Record<string, CategoriesDistribution>;

/** A record's place in one order of results: its Elasticsearch sort values, or its Meilisearch offset. */
export type SearchPlace = readonly (string | number | boolean | null)[];

/** What one search asks an engine for. */
export type SearchRequest = {
	/** The words searched for; empty lists records without ranking them by words. */
	text: string;
	/** The fields the words are searched in, the most important first. */
	fields: readonly string[];
	/** Every filter must hold. */
	filters: readonly SearchFilter[];
	/** A chosen order (`field:asc` entries); without one, the most relevant come first. */
	sort?: readonly string[];
	size: number;
	/** Where the results start: an offset, the record after or before a place, or the end of the results. */
	from?: number;
	after?: SearchPlace;
	before?: SearchPlace;
	fromEnd?: boolean;
	/** The record fields to send back: only these, or all but these. */
	returned?: { only: readonly string[] } | { except: readonly string[] };
	/** Facets to count values of across all the results. */
	facets?: readonly string[];
	/** False when a count past the results asked for isn't needed. */
	exactTotal?: boolean;
	/** Stops the search, as when the reader who asked has gone. */
	signal?: AbortSignal;
	/**
	 * Also rank by meaning with the library's embedder, `ratio` (0 to 1) of the way (OpenDevEd/new-el#720): by the
	 * text's meaning, or in Elasticsearch, by the stored meaning of the record `like` names. Elasticsearch mixes the
	 * two orders and answers no cursor; with a chosen order (`sort`) it ranks by words alone.
	 */
	semantic?: { ratio: number; like?: string };
};

/** The record a search by its meaning starts from has no vector yet. */
export class SearchMeaningUnavailableError extends Error {
	constructor(key: string) {
		super(`Record ${key} has no vector yet.`);
		this.name = "SearchMeaningUnavailableError";
	}
}

/** What one search answers. */
export type SearchAnswer<T> = {
	hits: T[];
	total: number;
	facets: FacetDistribution;
	/** The places of the first and last hit, for a cursor to the pages either side. */
	first: SearchPlace | null;
	last: SearchPlace | null;
};

/**
 * A deep read can't be trusted: the results changed while it walked them, so it may skip or repeat records, or the
 * index can't reach that deep (`notReady`).
 */
export class SearchChangedError extends Error {
	constructor(readonly notReady = false) {
		super(notReady ? "The search index is not ready for complete exports." : "The search results changed while they were read.");
		this.name = "SearchChangedError";
	}
}

/** One library's search in one engine. */
export interface SearchEngine {
	readonly name: SearchEngineName;
	search<T>(request: SearchRequest): Promise<SearchAnswer<T>>;
	/** Several searches in one round trip, answered in order. */
	searchMany<T>(requests: readonly SearchRequest[]): Promise<SearchAnswer<T>[]>;
	/** One record by key with every field but `except`, or null when the library has none under that key. */
	read<T>(key: string, except: readonly string[]): Promise<T | null>;
	/**
	 * The keys of `count` results from `offset` on, however deep, and how many results there are. Throws
	 * `SearchChangedError` when a write could have moved results while they were read.
	 */
	keys(request: SearchRequest, offset: number, count: number, signal: AbortSignal): Promise<{ keys: string[]; total: number }>;
}

/** One order of results: the engine, the chosen sort, and whether words rank them. A cursor holds a place in one. */
export type SearchOrder = { engine: SearchEngineName; sort: readonly string[]; ranked: boolean };

export function searchOrder(engine: SearchEngineName, request: Pick<SearchRequest, "text" | "sort">): SearchOrder {
	return { engine, sort: request.sort ?? [], ranked: request.text.trim() !== "" };
}

/** How many values a place holds in an order: Meilisearch's offset, or Elasticsearch's sort values and record key. */
function placeLength(order: SearchOrder) {
	return order.engine === "meilisearch" ? 1 : (order.ranked ? 1 : 0) + order.sort.length + 1;
}

/** A short name for an order (FNV-1a of it), which a cursor carries. */
function orderName(order: SearchOrder) {
	let hash = 0x811c9dc5;
	for (const character of JSON.stringify(order)) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
	return (hash >>> 0).toString(36);
}

type Cursor = { order: string; at: SearchPlace };

/** Where a page continues from, written for a URL: the place of the record next to it, in the order it belongs to. */
export function encodeCursor(order: SearchOrder, place: SearchPlace | null) {
	if (!place) return null;
	const cursor: Cursor = { order: orderName(order), at: place };
	return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** Sort fields that hold numbers. Elasticsearch places a record without one at "Infinity" or "-Infinity". */
const NUMBER_SORT_FIELDS = new Set(["citationCount", "dateSortKey", "year"]);

/** Whether a sort value can be one of this sort field's, which Elasticsearch refuses otherwise. */
function fitsSortField(value: unknown, entry: string) {
	if (!NUMBER_SORT_FIELDS.has(entry.split(":")[0]!)) return typeof value === "string" || value === null;
	return typeof value === "number" || value === "Infinity" || value === "-Infinity";
}

/** Whether Elasticsearch's place fits the order: the relevance score, each sort field's value, then the key. */
function fitsElasticsearchOrder(place: unknown[], order: SearchOrder) {
	const values = order.ranked ? place.slice(1) : place;
	return (
		(!order.ranked || typeof place[0] === "number") &&
		order.sort.every((entry, index) => fitsSortField(values[index], entry)) &&
		typeof values.at(-1) === "string"
	);
}

/** Whether a cursor's place fits the order: Meilisearch's is an offset, Elasticsearch's are sort values and a key. */
function fitsOrder(place: unknown[], order: SearchOrder) {
	if (place.length !== placeLength(order)) return false;
	return order.engine === "meilisearch" ? Number.isSafeInteger(place[0]) && (place[0] as number) >= 0 : fitsElasticsearchOrder(place, order);
}

/** The place a cursor holds, or null when it is no cursor for this order. */
export function decodeCursor(cursor: string | null | undefined, order: SearchOrder): SearchPlace | null {
	if (!cursor) return null;
	try {
		const read = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<Cursor>;
		const place = Array.isArray(read.at) ? read.at : [];
		return read.order === orderName(order) && fitsOrder(place, order) ? place : null;
	} catch {
		return null;
	}
}
