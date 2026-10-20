const OPERATORS = new Set(["or", "and", "not", "stemmed", "where"]);
const TOPIC = /^T\d{4,}$/u;

/** OQL as quoted phrases, brackets and bare words, so nothing inside quotes is ever read as part of the query. */
function tokens(oql: string) {
	return oql.match(/"[^"]*"|[()]|[^\s()"]+/gu) ?? [];
}

/** The tokens a text search looks for: the bracketed group after `has`, or its single word or phrase. */
function clause(parts: string[], start: number) {
	if (parts[start] !== "(") return parts.slice(start, start + 1);
	let depth = 0;
	for (let index = start; index < parts.length; index++) {
		if (parts[index] === "(") depth++;
		else if (parts[index] === ")" && --depth === 0) return parts.slice(start, index + 1);
	}
	return parts.slice(start);
}

/** A `has` after a field name is a text search; after an operator or bracket it is a flag such as `has DOI is (true)`. */
function searches(parts: string[], index: number) {
	const field = parts[index - 1];
	return parts[index]!.toLowerCase() === "has" && field !== undefined && field !== "(" && !field.startsWith('"') && !OPERATORS.has(field.toLowerCase());
}

/** What an OpenAlex source asks: one OQL query, or a search and a filter. */
type OpenAlexQuery = { oql?: string; search?: string; filter?: string };

/** The search texts a filter carries (`<field>.search:` and `.search.exact:`), and the topics it names. */
function filterParts(filter: string) {
	const entries = filter.match(/[a-z_.]+:(?:"[^"]*"|[^,"])*/gu) ?? [];
	const searches = entries.flatMap((entry) => (/^[a-z_.]+\.search(?:\.exact)?:/u.test(entry) ? [entry.slice(entry.indexOf(":") + 1)] : []));
	const topics = entries.flatMap((entry) => (entry.startsWith("topics.id:") ? entry.slice("topics.id:".length).split("|") : []));
	return { searches, topics };
}

/** Every word and phrase a search text looks for, without its brackets and operators. */
function searchTerms(text: string) {
	return tokens(text)
		.filter((token) => token !== "(" && token !== ")")
		.map((token) => token.replace(/^"|"$/gu, "").trim().toLowerCase())
		.filter((term) => term && !OPERATORS.has(term));
}

/** The words and phrases an OQL query's `<field> has ...` clauses look for, and the topics it names. */
function oqlTerms(oql: string) {
	const parts = tokens(oql);
	return {
		terms: parts.flatMap((_, index) => (searches(parts, index) ? clauseTerms(parts, index + 1) : [])),
		topics: parts.filter((part) => TOPIC.test(part)),
	};
}

/** The words and phrases a search and its filter look for, and the topics the filter names. */
function searchAndFilterTerms(query: OpenAlexQuery) {
	const filter = filterParts(query.filter ?? "");
	const texts = [...(query.search ? [query.search] : []), ...filter.searches];
	return { terms: texts.flatMap(searchTerms), topics: filter.topics.filter((topic) => TOPIC.test(topic)) };
}

/**
 * What the sources search for, each counted once across them, as a reader would count them: the words and phrases
 * an OQL query's `<field> has ...` clauses or a search text look for, and the OpenAlex topics either names.
 */
export function queryTerms(queries: readonly OpenAlexQuery[]) {
	const read = queries.map((query) => (query.oql ? oqlTerms(query.oql) : searchAndFilterTerms(query)));
	return {
		terms: new Set(read.flatMap((query) => query.terms)).size,
		topics: new Set(read.flatMap((query) => query.topics)).size,
	};
}

/** The words and phrases one `has` clause looks for, without its brackets and operators. */
function clauseTerms(parts: string[], start: number) {
	return clause(parts, start)
		.filter((token) => token !== "(" && token !== ")")
		.map((token) => token.replace(/^"|"$/gu, "").trim().toLowerCase())
		.filter((term) => term && !OPERATORS.has(term));
}
