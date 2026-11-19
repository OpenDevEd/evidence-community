import "server-only";

import type { Embedder } from "meilisearch";

import meilisearchClient from "@/lib/meilisearch";

/**
 * Search text some models need in front of it. Meilisearch's request template can't add a prefix (it only takes
 * `{{text}}` as a whole value), so the app embeds every search itself and passes the vector.
 */
const SEARCH_PREFIX: Record<string, string> = {
	"google/gemini-embedding-2": "task: search result | query: ",
};

const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";

/** Recent searches' vectors: the results and their facet counts ask for the same one. */
const VECTOR_CACHE_SIZE = 500;
const vectors = new Map<string, Promise<number[]>>();

type SearchEmbedder = {
	name: string;
	/** The OpenRouter model that makes vectors comparable to the index's, when the app can embed for it. */
	model?: string;
	prefix: string;
	dimensions?: number;
};

function describe(name: string, embedder: NonNullable<Embedder>): SearchEmbedder {
	// Meilisearch's openAi source: OpenRouter serves the same OpenAI model, so its vectors match the stored ones.
	if (embedder.source === "openAi") {
		return { name, model: `openai/${embedder.model ?? "text-embedding-3-small"}`, prefix: "", dimensions: embedder.dimensions };
	}
	if (embedder.source === "rest" && typeof embedder.request?.model === "string") {
		const model = embedder.request.model;
		return { name, model, prefix: SEARCH_PREFIX[model] ?? "", dimensions: embedder.dimensions };
	}
	return { name, prefix: "" };
}

/**
 * The index's one embedder, which the sync service sets per library. Read on each use, about a millisecond: a cached
 * name would break searches for as long as it outlived a switch.
 */
export async function getSearchEmbedder(indexName: string): Promise<SearchEmbedder> {
	const embedders = Object.entries((await meilisearchClient.index(indexName).getEmbedders()) ?? {}).filter(
		(entry): entry is [string, NonNullable<Embedder>] => entry[1] !== null,
	);
	if (embedders.length !== 1) {
		throw new Error(`Index ${indexName} has ${embedders.length} embedders; search by meaning needs exactly one.`);
	}
	return describe(...embedders[0]);
}

async function embedSearchText(model: string, input: string, dimensions: number | undefined) {
	const apiKey = process.env.OPENROUTER_API_KEY?.trim();
	if (!apiKey) throw new Error(`OPENROUTER_API_KEY is required to search with ${model}.`);

	const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
		body: JSON.stringify({ model, input: [input], ...(dimensions ? { dimensions } : {}) }),
	});
	const body = await response.text();
	if (!response.ok) {
		throw new Error(`Embedding search text with ${model} failed: ${response.status} ${body.slice(0, 500)}`);
	}
	const vector = (JSON.parse(body) as { data?: Array<{ embedding?: unknown }> }).data?.[0]?.embedding;
	if (!Array.isArray(vector)) {
		throw new Error(`Embedding search text with ${model} returned no vector: ${body.slice(0, 500)}`);
	}
	return vector as number[];
}

function cachedVector(model: string, input: string, dimensions: number | undefined) {
	const key = `${model}:${dimensions ?? ""}:${input}`;
	const cached = vectors.get(key);
	if (cached) return cached;
	const vector = embedSearchText(model, input, dimensions);
	vectors.set(key, vector);
	// A failed embedding must not stay cached.
	vector.catch(() => vectors.delete(key));
	if (vectors.size > VECTOR_CACHE_SIZE) vectors.delete(vectors.keys().next().value!);
	return vector;
}

/** The `hybrid` options and the search's own vector, made by the app for the index's model when it can. */
export async function hybridSearchOptions(indexName: string, text: string, semanticRatio: number) {
	const { name, model, prefix, dimensions } = await getSearchEmbedder(indexName);
	const hybrid = { embedder: name, semanticRatio };
	if (!model) return { hybrid };
	return { hybrid, vector: await cachedVector(model, prefix + text, dimensions) };
}
