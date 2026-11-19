import "server-only";

import type { Index, RecordAny, SearchParams } from "meilisearch";
import { getCachedStatus } from "@/app/api/cache";
import { isFeatureFlagEnabled } from "@/lib/feature-flags";
import { getServerFeatureFlags } from "@/lib/server-feature-flags";
import { hybridSearchOptions } from "./search-embedder";
import { listedMeaningKeys, WORDS_ONLY_SCOPES } from "./meaning-search-rules";

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

type HybridOptions = NonNullable<Awaited<ReturnType<typeof meaningSearchOptions>>>;


export type MeaningList = {
	/** Every listed record, closest first. */
	keys: string[];
	usingWords: ReadonlySet<string>;
};

/** The records a meaning search lists: see `listedMeaningKeys`. */
export async function meaningList(
	index: Index<RecordAny>,
	search: string,
	hybrid: HybridOptions,
	attributesToSearchOn: string[],
	filter: string[],
): Promise<MeaningList> {
	// The index's own cap on listed results: a word search can page no further, so neither can this list.
	const { maxTotalHits } = await index.getPagination();
	const keysOf = (options: SearchParams) =>
		index
			.search(search, { ...options, limit: maxTotalHits ?? 1000, attributesToSearchOn, attributesToRetrieve: ["key"], filter })
			.then(({ hits }) => hits.map(({ key }) => String(key)));
	// The word matches on their own, so none is lost when the meaning ranking fills the cap before reaching it.
	const [rankedKeys, wordKeys] = await Promise.all([keysOf(hybrid), keysOf({})]);
	const usingWords = new Set(wordKeys);
	return { keys: listedMeaningKeys(rankedKeys, usingWords), usingWords };
}

/** One page of a meaning list: in its own order, or in the reader's sort when they chose one. */
export async function meaningPage(
	index: Index<RecordAny>,
	list: MeaningList,
	{
		offset,
		limit,
		sort,
		attributesToRetrieve,
		filter,
	}: { offset: number; limit: number; sort?: string; attributesToRetrieve: string[]; filter: string[] },
) {
	const keys = sort ? list.keys : list.keys.slice(offset, offset + limit);
	if (keys.length === 0) return [];
	const { hits } = await index.search("", {
		offset: sort ? offset : 0,
		limit,
		attributesToRetrieve,
		...(sort ? { sort: [sort] } : {}),
		filter: [...filter, `key IN ${JSON.stringify(keys)}`],
	});
	if (sort) return hits;
	const byKey = new Map(hits.map((hit) => [String(hit.key), hit]));
	return keys.flatMap((key) => byKey.get(key) ?? []);
}
