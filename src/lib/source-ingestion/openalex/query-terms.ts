const OPERATORS = new Set(["or", "and", "not", "stemmed"]);

/** Where a `has` clause's words end: its closing bracket, or the end of the single word or phrase after it. */
function clauseEnd(oql: string, start: number) {
	if (oql[start] !== "(") return start + (oql.slice(start).match(/^"[^"]*"|^\S+/u)?.[0].length ?? 0);
	let depth = 0;
	for (let index = start; index < oql.length; index++) {
		if (oql[index] === '"') index = oql.indexOf('"', index + 1);
		else if (oql[index] === "(") depth++;
		else if (oql[index] === ")" && --depth === 0) return index + 1;
		if (index < 0) break;
	}
	return oql.length;
}

/**
 * What OQL searches each count once across the queries, as a reader would count them: the words and phrases its
 * `has` clauses look for, and the OpenAlex topics it names.
 */
export function queryTerms(queries: readonly string[]) {
	const terms = new Set<string>();
	const topics = new Set<string>();
	for (const oql of queries) {
		const has = /\bhas\b\s*/giu;
		while (has.exec(oql)) {
			const end = clauseEnd(oql, has.lastIndex);
			for (const [, quoted, word] of oql.slice(has.lastIndex, end).matchAll(/"([^"]+)"|([^\s()"]+)/gu)) {
				const term = (quoted ?? word)!.trim().toLowerCase();
				if (term && !OPERATORS.has(term)) terms.add(term);
			}
			has.lastIndex = end;
		}
		for (const [topic] of oql.replace(/"[^"]*"/gu, "").matchAll(/\bT\d{4,}\b/gu)) topics.add(topic);
	}
	return { terms: terms.size, topics: topics.size };
}
