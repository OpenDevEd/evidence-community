// Mock: five ways search could use meaning, switched with the `concept` URL parameter.

export const SEMANTIC_CONCEPTS = [
	{ id: 1, name: "Blended", detail: "Every search mixes words and meaning" },
	{ id: 2, name: "Understood query", detail: "The query is translated, then searched by words" },
	{ id: 3, name: "Rescue", detail: "Meaning steps in when words find almost nothing" },
	{ id: 4, name: "More like this", detail: "Any record can start a search by meaning" },
	{ id: 5, name: "Themes", detail: "The closest records, grouped into themes" },
] as const;

/** Every record has some meaning score, so a search by meaning lists only this many of the closest. */
export const MEANING_RESULT_LIMIT = 50;

/** Rescue takes over when words find fewer records than this. */
export const RESCUE_BELOW = 3;

export type SemanticInfo = {
	concept: number;
	/** Blended: records on this page found by meaning alone. */
	meaningOnlyKeys?: string[];
	/** Understood query: what the search was taken to mean, in the library's language. */
	understood?: { query: string; original: string; literal: boolean };
	/** Rescue: words found this few, so the list is the closest by meaning. */
	rescued?: { wordsTotal: number };
	/** More like this: the record the list is built around. */
	similarTo?: { key: string; title: string };
	/** Themes: the closest records grouped by meaning. */
	themes?: Array<{ label: string; count: number }>;
};
