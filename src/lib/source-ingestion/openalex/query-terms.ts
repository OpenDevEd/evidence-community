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

/**
 * What OQL searches each count once across the queries, as a reader would count them: the words and phrases its
 * `<field> has ...` clauses look for, and the OpenAlex topics it names.
 */
export function queryTerms(queries: readonly string[]) {
	const terms = new Set<string>();
	const topics = new Set<string>();
	for (const oql of queries) {
		const parts = tokens(oql);
		for (const [index, part] of parts.entries()) {
			if (TOPIC.test(part)) topics.add(part);
			if (searches(parts, index)) for (const term of clauseTerms(parts, index + 1)) terms.add(term);
		}
	}
	return { terms: terms.size, topics: topics.size };
}

/** The words and phrases one `has` clause looks for, without its brackets and operators. */
function clauseTerms(parts: string[], start: number) {
	return clause(parts, start)
		.filter((token) => token !== "(" && token !== ")")
		.map((token) => token.replace(/^"|"$/gu, "").trim().toLowerCase())
		.filter((term) => term && !OPERATORS.has(term));
}
