import "server-only";

import type { Hits, RecordAny } from "meilisearch";
import meilisearchClient from "./meilisearch";
import { getSearchEmbedder, hybridSearchOptions } from "./search-embedder";
import { MEANING_RESULT_LIMIT, RESCUE_BELOW, type SemanticInfo } from "./semantic-concepts";

// shortcut: mock — model answers are cached in this process only; the real version stores them.
const modelCache = new Map<string, unknown>();

const LANGUAGE_NAMES: Record<string, string> = {
	"en-GB": "English", "en-US": "English", de: "German", ar: "Arabic", hi: "Hindi",
	fr: "French", cn: "Simplified Chinese", sw: "Swahili", pt: "Portuguese",
};

async function askModel<T>(cacheKey: string, system: string, user: string): Promise<T> {
	if (modelCache.has(cacheKey)) return modelCache.get(cacheKey) as T;
	const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
		body: JSON.stringify({
			model: "anthropic/claude-haiku-5.5",
			// Translation needs no reasoning.
				reasoning: { effort: "none" },
				response_format: { type: "json_object" },
			messages: [{ role: "system", content: system }, { role: "user", content: user }],
		}),
	});
	const body = await response.text();
	if (!response.ok) throw new Error(`Model call failed: ${response.status} ${body.slice(0, 300)}`);
	const answer = JSON.parse(JSON.parse(body).choices?.[0]?.message?.content ?? "{}") as T;
	modelCache.set(cacheKey, answer);
	return answer;
}

/** The search in the library's language, as short search words; null when it already is. */
export async function understandQuery(search: string): Promise<string | null> {
	const { query } = await askModel<{ query?: string }>(
		`understand:${search}`,
		'The library\'s records are in English. Rewrite the user\'s library search as short English search words. If it is already English, return it unchanged. Reply with JSON {"query"}.',
		search,
	);
	const understood = query?.trim();
	return understood && understood.toLowerCase() !== search.trim().toLowerCase() ? understood : null;
}

type Request = {
	indexName: string;
	concept: number;
	search: string;
	like: string;
	theme: number;
	literal: boolean;
	locale: string;
	offset: number;
	limit: number;
	attributesToSearchOn: string[];
	attributesToRetrieve: string[];
	sort?: string[];
	filter: string[];
};

type Result = { hits: Hits<RecordAny>; total: number; semantic: SemanticInfo };

/** The concept's results, or null when it leaves the search to words as usual. */
export async function semanticSearch(request: Request): Promise<Result | null> {
	const { concept, search, like } = request;
	const hasQuery = search.trim().length > 0;
	if (concept === 4 && like) return moreLikeThis(request);
	if (!hasQuery) return null;
	if (concept === 1) return blended(request);
	if (concept === 2) return understoodQuery(request);
	if (concept === 3) return rescue(request);
	if (concept === 5) return themes(request);
	return null;
}

const index = (name: string) => meilisearchClient.index(name);

function wordsOptions(r: Request) {
	return {
		offset: r.offset,
		limit: r.limit,
		attributesToSearchOn: r.attributesToSearchOn,
		attributesToRetrieve: r.attributesToRetrieve,
		filter: r.filter,
		...(r.sort ? { sort: r.sort } : {}),
	};
}

async function blended(r: Request): Promise<Result> {
	const [words, mixed] = await Promise.all([
		index(r.indexName).search(r.search, {
			limit: 1000,
			attributesToRetrieve: ["key"],
			attributesToSearchOn: r.attributesToSearchOn,
			filter: r.filter,
		}),
		index(r.indexName).search(r.search, {
			...wordsOptions(r),
			...(await hybridSearchOptions(r.indexName, r.search, 0.5)),
		}),
	]);
	const wordKeys = new Set(words.hits.map(({ key }) => String(key)));
	const wordsTotal = words.estimatedTotalHits ?? words.hits.length;
	return {
		hits: mixed.hits,
		total: Math.max(wordsTotal, MEANING_RESULT_LIMIT),
		semantic: {
			concept: 1,
			wordsTotal,
			meaningOnlyKeys: mixed.hits.map(({ key }) => String(key)).filter((key) => !wordKeys.has(key)),
		},
	};
}

async function understoodQuery(r: Request): Promise<Result> {
	const understood = await understandQuery(r.search);
	const query = understood && !r.literal ? understood : r.search;
	const result = await index(r.indexName).search(query, wordsOptions(r));
	return {
		hits: result.hits,
		total: result.estimatedTotalHits ?? result.hits.length,
		semantic: {
			concept: 2,
			...(understood ? { understood: { query: understood, original: r.search, literal: r.literal } } : {}),
		},
	};
}

async function rescue(r: Request): Promise<Result> {
	const words = await index(r.indexName).search(r.search, wordsOptions(r));
	const wordsTotal = words.estimatedTotalHits ?? words.hits.length;
	if (wordsTotal >= RESCUE_BELOW) {
		return { hits: words.hits, total: wordsTotal, semantic: { concept: 3 } };
	}
	const meaning = await index(r.indexName).search(r.search, {
		...wordsOptions(r),
		...(await hybridSearchOptions(r.indexName, r.search, 1)),
	});
	return { hits: meaning.hits, total: MEANING_RESULT_LIMIT, semantic: { concept: 3, rescued: { wordsTotal } } };
}

async function moreLikeThis(r: Request): Promise<Result> {
	const { name } = await getSearchEmbedder(r.indexName);
	const [similar, record] = await Promise.all([
		index(r.indexName).searchSimilarDocuments({
			id: r.like,
			embedder: name,
			filter: r.filter,
			offset: r.offset,
			limit: r.limit,
			attributesToRetrieve: r.attributesToRetrieve,
		}),
		index(r.indexName).getDocument(r.like, { fields: ["title"] }),
	]);
	return {
		hits: similar.hits,
		total: Math.min(similar.estimatedTotalHits ?? MEANING_RESULT_LIMIT, MEANING_RESULT_LIMIT),
		semantic: { concept: 4, similarTo: { key: r.like, title: String(record.title ?? "").replace(/<[^>]+>/g, "") } },
	};
}

const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const normalise = (v: number[]) => {
	const length = Math.sqrt(dot(v, v)) || 1;
	return v.map((value) => value / length);
};

/** k-means by angle, seeded with the closest hit and then the hit farthest from every chosen seed. */
function cluster(vectors: number[][], k: number) {
	const seeds = [vectors[0]];
	while (seeds.length < k) {
		const farthest = vectors.reduce((best, v, i) =>
			Math.max(...seeds.map((s) => dot(s, v))) < Math.max(...seeds.map((s) => dot(s, vectors[best]))) ? i : best, 0);
		seeds.push(vectors[farthest]);
	}
	let centres = seeds;
	let assignment = vectors.map(() => 0);
	for (let round = 0; round < 12; round++) {
		assignment = vectors.map((v) => centres.reduce((best, c, i) => (dot(c, v) > dot(centres[best], v) ? i : best), 0));
		centres = centres.map((centre, i) => {
			const members = vectors.filter((_, j) => assignment[j] === i);
			if (members.length === 0) return centre;
			return normalise(members[0].map((_, d) => members.reduce((sum, m) => sum + m[d], 0)));
		});
	}
	return assignment;
}

async function themes(r: Request): Promise<Result> {
	const { name } = await getSearchEmbedder(r.indexName);
	const closest = await index(r.indexName).search(r.search, {
		limit: MEANING_RESULT_LIMIT,
		attributesToSearchOn: r.attributesToSearchOn,
		attributesToRetrieve: [...new Set([...r.attributesToRetrieve, "key", "title"])],
		filter: r.filter,
		...(await hybridSearchOptions(r.indexName, r.search, 1)),
	});
	const hits = closest.hits;
	// Search leaves vectors out on Meilisearch 1.43, so they come from the documents themselves.
	const stored = await index(r.indexName).getDocuments({
		ids: hits.map(({ key }) => String(key)),
		fields: ["key", "_vectors"],
		retrieveVectors: true,
		limit: hits.length,
	});
	const vectorOf = new Map(
		stored.results.map((doc) => [String(doc.key), (doc._vectors as Record<string, { embeddings: number[][] }>)[name].embeddings[0]]),
	);
	const vectors = hits.map(({ key }) => normalise(vectorOf.get(String(key)) ?? []));
	const assignment = cluster(vectors, Math.min(4, hits.length));
	const groups = [...new Set(assignment)]
		.map((id) => hits.filter((_, i) => assignment[i] === id))
		.sort((a, b) => b.length - a.length);
	const language = LANGUAGE_NAMES[r.locale] ?? "English";
	const { labels = [] } = await askModel<{ labels?: string[] }>(
		`themes:${r.locale}:${r.search}:${groups.map((g) => g.map(({ key }) => key).join(",")).join("|")}`,
		`Name each group of research records with a short theme of 2 to 5 words in ${language}. Themes must tell the groups apart. Reply with JSON {"labels":[...]} in the same order.`,
		JSON.stringify(groups.map((group) => group.slice(0, 8).map(({ title }) => String(title ?? "").replace(/<[^>]+>/g, "")))),
	);
	const listed = r.theme >= 0 && groups[r.theme] ? groups[r.theme] : hits;
	return {
		hits: listed.slice(r.offset, r.offset + r.limit),
		total: listed.length,
		semantic: { concept: 5, themes: groups.map((group, i) => ({ label: labels[i] ?? `${i + 1}`, count: group.length })) },
	};
}
