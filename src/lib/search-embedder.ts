import "server-only";

import type { Embedder } from "meilisearch";

import meilisearchClient from "@/lib/meilisearch";

/**
 * Searches on models whose search text needs a prefix Meilisearch can't add: its request template only takes
 * `{{text}}` as a whole value. The app embeds those searches itself and passes the vector.
 */
const SEARCH_PREFIX: Record<string, string> = {
	"google/gemini-embedding-2": "task: search result | query: ",
};

const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const EMBEDDER_LOOKUP_TTL_MS = 5 * 60_000;

type SearchEmbedder = {
	name: string;
	/** Set when the app must embed search text itself before Meilisearch can rank by meaning. */
	model?: string;
	prefix?: string;
	dimensions?: number;
};

const lookups = new Map<string, { embedder: SearchEmbedder; until: number }>();

function describe(name: string, embedder: NonNullable<Embedder>): SearchEmbedder {
	if (embedder.source !== "rest" || typeof embedder.request?.model !== "string") return { name };
	const model = embedder.request.model;
	const prefix = SEARCH_PREFIX[model];
	return prefix ? { name, model, prefix, dimensions: embedder.dimensions } : { name };
}

/** The index's one embedder, which the sync service sets per library. */
export async function getSearchEmbedder(indexName: string): Promise<SearchEmbedder> {
	const cached = lookups.get(indexName);
	if (cached && cached.until > Date.now()) return cached.embedder;

	const embedders = Object.entries((await meilisearchClient.index(indexName).getEmbedders()) ?? {}).filter(
		(entry): entry is [string, NonNullable<Embedder>] => entry[1] !== null,
	);
	if (embedders.length !== 1) {
		throw new Error(`Index ${indexName} has ${embedders.length} embedders; search by meaning needs exactly one.`);
	}
	const embedder = describe(...embedders[0]);
	lookups.set(indexName, { embedder, until: Date.now() + EMBEDDER_LOOKUP_TTL_MS });
	return embedder;
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

/** The `hybrid` options, and the search's own vector when the index's model needs the app to embed it. */
export async function hybridSearchOptions(indexName: string, text: string, semanticRatio: number) {
	const { name, model, prefix, dimensions } = await getSearchEmbedder(indexName);
	const hybrid = { embedder: name, semanticRatio };
	if (!model || !prefix) return { hybrid };
	return { hybrid, vector: await embedSearchText(model, prefix + text, dimensions) };
}
