/**
 * A first translation of a reader's search into Elasticsearch, for `compareSearchEngines.ts` (OpenDevEd/new-el#717).
 * The public search (#721) replaces it with the real translation, and the comparison then uses that.
 */
import type { resolveSearchRequest } from "../../src/lib/search";

type SearchRequest = ReturnType<typeof resolveSearchRequest>;
type Clause = Record<string, unknown>;

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
