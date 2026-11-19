/** Shared by the server search and the page: when meaning search applies, and what the results say about it. */

/**
 * Scopes searched by words alone: names carry no meaning to match, and a record's vector is built from its title,
 * metadata and abstract, never its PDF text.
 */
export const WORDS_ONLY_SCOPES: readonly string[] = ["authors", "documents"];

/** Every record has some meaning score, so meaning adds records only from the closest this many, or as many as use the words. */
export const MEANING_RESULT_LIMIT = 50;

/**
 * What a meaning search lists, closest first: every record that uses the search's words, however low it ranks, and
 * the records close in meaning alone that rank among the closest max(word matches, 50). Word matches the ranking
 * left out come last, in the order the word search gives (`usingWords` keeps it). The list never passes `cap`.
 */
export function listedMeaningKeys(ranked: string[], usingWords: ReadonlySet<string>, cap = Infinity) {
	const closest = Math.max(usingWords.size, MEANING_RESULT_LIMIT);
	// Under the index's cap every word match keeps its place; meaning-only records get the room left.
	let meaningRoom = Math.max(0, cap - usingWords.size);
	const inRanking = new Set(ranked);
	return [
		...ranked.filter((key, rank) => usingWords.has(key) || (rank < closest && meaningRoom-- > 0)),
		...[...usingWords].filter((key) => !inRanking.has(key)),
	];
}

/** Below this many word matches the page says that most results are by meaning, and offers to hide them. */
export const FEW_WORD_MATCHES = 10;

export type MeaningInfo = {
	/** Records whose title, abstract or other searched fields contain the search's words. */
	wordsTotal: number;
	/** Results on this page found by meaning alone. */
	meaningOnlyKeys: string[];
	/** The reader hid the results found by meaning alone. */
	wordsOnly: boolean;
};
