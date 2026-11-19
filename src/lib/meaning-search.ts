import "server-only";

import type { Index, RecordAny } from "meilisearch";
import { getCachedStatus } from "@/app/api/cache";
import { isFeatureFlagEnabled } from "@/lib/feature-flags";
import { getServerFeatureFlags } from "@/lib/server-feature-flags";
import { hybridSearchOptions } from "./search-embedder";
import { MEANING_RESULT_LIMIT, WORDS_ONLY_SCOPES } from "./meaning-search-rules";

/** Half words, half meaning: records that use the search's words still rank first. */
const SEMANTIC_RATIO = 0.5;

/** The `meaning-search` flag is on, there is something to search, and the scope compares meaning. */
export async function meaningSearchApplies(search: string, scope: string) {
	if (!search.trim() || WORDS_ONLY_SCOPES.includes(scope)) return false;
	return isFeatureFlagEnabled(getServerFeatureFlags((await getCachedStatus()).companyFooter), "meaning-search");
}

/**
 * The hybrid options for a search that adds results by meaning. Null when the search can't be embedded (no key, an
 * unreachable embedding provider, an index without one embedder): the search then stays with words, and the reason
 * is logged, rather than failing outright.
 */
export async function meaningSearchOptions(indexName: string, search: string) {
	try {
		return await hybridSearchOptions(indexName, search, SEMANTIC_RATIO);
	} catch (error) {
		console.error("[meaning-search] searching by words only:", error);
		return null;
	}
}

/** How many records use the search's words. */
export async function wordMatchCount(index: Index<RecordAny>, search: string, attributesToSearchOn: string[], filter: string[]) {
	const result = await index.search(search, { limit: 0, attributesToSearchOn, filter });
	return result.estimatedTotalHits ?? 0;
}

/** Of these keys, the ones whose records use the search's words. */
export async function keysUsingWords(
	index: Index<RecordAny>,
	search: string,
	keys: string[],
	attributesToSearchOn: string[],
	filter: string[],
) {
	if (keys.length === 0) return new Set<string>();
	const result = await index.search(search, {
		limit: keys.length,
		attributesToSearchOn,
		attributesToRetrieve: ["key"],
		filter: [...filter, `key IN ${JSON.stringify(keys)}`],
	});
	return new Set(result.hits.map(({ key }) => String(key)));
}

/** A search's result count once meaning is added: its word matches, or up to the meaning limit when they are fewer. */
export const meaningResultTotal = (hybridTotal: number, wordsTotal: number) =>
	Math.min(hybridTotal, Math.max(wordsTotal, MEANING_RESULT_LIMIT));
