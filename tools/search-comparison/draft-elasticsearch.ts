/**
 * A first Elasticsearch index and search for `compareSearchEngines.ts` (OpenDevEd/new-el#717): enough to measure
 * load time, size, and latency on real records. The search worker (#719) and the public search (#721) replace it
 * with the real mapping and query translation, and the comparison then uses theirs.
 */
import type { resolveSearchRequest } from "../../src/lib/search";

type SearchRequest = ReturnType<typeof resolveSearchRequest>;
type Clause = Record<string, unknown>;

/** Fields readers filter or sort on, kept whole as keywords. Searched ones also get an analysed `.text` field. */
const KEYWORD_FIELDS = [
	"key", "itemType", "studyType", "studyTypeShown", "institutionsWithAuthors", "country", "authorCountry",
	"collections", "collectionsAncestry", "topicAncestors", "provider", "sourceConnectionKey", "sources",
];
const SEARCHED_KEYWORD_FIELDS = ["tags", "fullNames"];

const text = { type: "text", analyzer: "library_text" };

export function draftElasticsearchIndex() {
	return {
		settings: {
			index: {
				number_of_shards: 1,
				number_of_replicas: 0,
				refresh_interval: "-1",
				"mapping.total_fields.limit": 10_000,
				// A record whose field holds a number in one record and text in another keeps the rest of it.
				"mapping.ignore_malformed": true,
			},
			analysis: {
				analyzer: { library_text: { type: "custom", tokenizer: "icu_tokenizer", filter: ["icu_folding"] } },
				normalizer: { sort_key: { type: "custom", filter: ["lowercase", "asciifolding"] } },
			},
		},
		mappings: {
			date_detection: false,
			numeric_detection: false,
			dynamic_templates: [{ strings: { match_mapping_type: "string", mapping: text } }],
			properties: {
				...Object.fromEntries(KEYWORD_FIELDS.map((field) => [field, { type: "keyword" }])),
				...Object.fromEntries(
					SEARCHED_KEYWORD_FIELDS.map((field) => [field, { type: "keyword", normalizer: "sort_key", fields: { text } }]),
				),
				title: { ...text, fields: { sort: { type: "keyword", normalizer: "sort_key", ignore_above: 512 } } },
				deleted: { type: "integer" },
				year: { type: "integer" },
				citationCount: { type: "long" },
				dateSortKey: { type: "double" },
				dateAdded: { type: "keyword" },
				updatedAt: { type: "keyword" },
				hasPdf: { type: "boolean" },
			},
		},
	};
}

const SEARCH_FIELD: Record<string, string> = { tags: "tags.text", fullNames: "fullNames.text" };
const SORT_FIELD: Record<string, string> = { title: "title.sort" };

function value(raw: string): unknown {
	const trimmed = raw.trim();
	if (trimmed.startsWith('"') || trimmed.startsWith("[")) return JSON.parse(trimmed);
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
	if (trimmed === "true" || trimmed === "false") return trimmed === "true";
	return trimmed;
}

/** One Meilisearch filter comparison as an Elasticsearch clause, and whether it excludes. */
function comparison(atom: string): { clause: Clause; exclude: boolean } {
	let match: RegExpMatchArray | null;
	if ((match = atom.match(/^([\w.]+) (NOT IN|IN) (\[[\s\S]*\])$/))) {
		return { clause: { terms: { [match[1]!]: value(match[3]!) } }, exclude: match[2] === "NOT IN" };
	}
	if ((match = atom.match(/^([\w.]+) EXISTS$/))) return { clause: { exists: { field: match[1]! } }, exclude: false };
	if ((match = atom.match(/^([\w.]+) (=|!=) ([\s\S]+)$/))) {
		return { clause: { term: { [match[1]!]: value(match[3]!) } }, exclude: match[2] === "!=" };
	}
	if ((match = atom.match(/^([\w.]+) (>=|<=|>|<) (.+)$/))) {
		const bound = { ">=": "gte", "<=": "lte", ">": "gt", "<": "lt" }[match[2]!]!;
		return { clause: { range: { [match[1]!]: { [bound]: value(match[3]!) } } }, exclude: false };
	}
	throw new Error(`The draft cannot translate the filter ${JSON.stringify(atom)}`);
}

function translateFilters(filters: readonly string[]) {
	const filter: Clause[] = [];
	const mustNot: Clause[] = [];
	for (const expression of filters) {
		if (/\bOR\b|[()]/.test(expression.replace(/"(?:[^"\\]|\\.)*"/g, ""))) {
			throw new Error(`The draft cannot translate the filter ${JSON.stringify(expression)}`);
		}
		for (const atom of expression.split(/ AND (?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
			const { clause, exclude } = comparison(atom.trim());
			(exclude ? mustNot : filter).push(clause);
		}
	}
	return { filter, mustNot };
}

function sortClause(sort: readonly string[] | undefined) {
	return (sort ?? []).map((entry) => {
		const [field, order] = entry.split(":") as [string, "asc" | "desc"];
		return { [SORT_FIELD[field] ?? field]: { order, missing: "_last", ...(field === "fullNames" ? { mode: order === "asc" ? "min" : "max" } : {}) } };
	});
}

/** The search body for one reader's search, as the draft translates it. */
export function draftElasticsearchSearch(request: SearchRequest, offset: number) {
	const { filter, mustNot } = translateFilters(request.finalFilters);
	const fields = request.attributesToSearchOn.map((field) => SEARCH_FIELD[field] ?? field);
	return {
		from: offset,
		size: request.limitNum,
		track_total_hits: true,
		_source: false,
		query: {
			bool: {
				must: request.search ? [{ multi_match: { query: request.search, type: "bool_prefix", fields, fuzziness: "AUTO" } }] : [],
				filter,
				must_not: mustNot,
			},
		},
		...(request.sortOption ? { sort: sortClause(request.sortOption) } : {}),
	};
}
