import { createHash } from "node:crypto";

import type { estypes } from "@elastic/elasticsearch";

import type { SearchService } from "@/lib/elasticsearch-factory";
import type { Embedder } from "@/lib/embedder";

import { embeddingText } from "./embedder-settings";
import type { ItemSearchDocument } from "./projection";
import { SearchOutboxAbortError } from "./writer";

/**
 * Records' vectors in Elasticsearch (OpenDevEd/new-el#720). Each record written carries the vector of its embedding
 * text: the one its index already holds when the same embedder made it from the same text, else a new one from the
 * embedder. While the embedder fails, records are written without one, so word search stays current, and
 * `embedMissing` embeds them once it answers again.
 */

type Stored = { embedding?: unknown; embeddingHash?: string };

export type ElasticsearchEmbeddings = {
	/** The documents with their vectors; any the embedder couldn't give are written without one. */
	attach(documents: readonly ItemSearchDocument[], signal?: AbortSignal): Promise<ItemSearchDocument[]>;
	/** Embeds records written without a vector, at most `MISSING_PER_CALL`; returns how many it embedded. */
	embedMissing(signal?: AbortSignal): Promise<number>;
	/** The embedder's last failure, until it answers again. */
	lastError(): string | null;
};

/** The fields the embedding text is made from. */
const TEXT_FIELDS = ["title", "abstractNote", "fullNames", "tags", "year"];

/** After a failure the embedder is left alone this long, doubling up to 30 minutes, and records go without vectors. */
const FIRST_PAUSE_MS = 60_000;
const LONGEST_PAUSE_MS = 30 * 60_000;

const MISSING_PAGE = 200;
const MISSING_PER_CALL = 2_000;

function hashOf(fingerprint: string, text: string) {
	return createHash("sha256").update(`${fingerprint}\n${text}`).digest("hex").slice(0, 32);
}

/** A vector Elasticsearch can compare by angle: a zero vector has none. */
function usable(vector: unknown): vector is number[] {
	return Array.isArray(vector) && vector.some((value) => value !== 0);
}

/** The vectors and hashes the library's index holds for these records; none before it has an index. */
async function readStored(search: SearchService, keys: readonly string[], signal?: AbortSignal) {
	if (keys.length === 0) return new Map<string, Stored>();
	const response = await search.client.search<Stored>(
		{
			index: search.alias,
			ignore_unavailable: true,
			size: keys.length,
			query: { ids: { values: [...keys] } },
			// Elasticsearch leaves vectors out of the records it sends back unless asked.
			_source: { includes: ["embedding", "embeddingHash"], exclude_vectors: false } as estypes.SearchSourceConfig,
		},
		{ signal },
	);
	return new Map(response.hits.hits.map((hit) => [String(hit._id), hit._source ?? {}]));
}

/** Records without a vector, after `after` in key order, with what they were last written as. */
function readMissing(search: SearchService, after: estypes.SortResults | undefined, signal?: AbortSignal) {
	return search.client.search<Record<string, unknown>>(
		{
			index: search.alias,
			ignore_unavailable: true,
			size: MISSING_PAGE,
			query: { bool: { must_not: [{ exists: { field: "embedding" } }] } },
			sort: [{ key: "asc" }],
			...(after ? { search_after: after } : {}),
			seq_no_primary_term: true,
			_source: { includes: TEXT_FIELDS },
		},
		{ signal },
	);
}

/** Bulk updates refused for another reason than a record written again meanwhile, which has its own vector. */
function refusedUpdates(response: estypes.BulkResponse) {
	return response.items.flatMap((item) => {
		const answer = item.update;
		return answer?.error && answer.status !== 409 && answer.status !== 404 ? [`${answer._id}: ${answer.error.type}: ${answer.error.reason ?? ""}`] : [];
	});
}

export function elasticsearchEmbeddings(search: SearchService, embedder: Embedder): ElasticsearchEmbeddings {
	let lastError: string | null = null;
	let pausedUntil = 0;
	let pause = FIRST_PAUSE_MS;

	/** Vectors for the texts, or null while the embedder fails. */
	async function embed(texts: readonly string[], signal?: AbortSignal) {
		if (texts.length === 0) return [];
		if (Date.now() < pausedUntil) return null;
		try {
			const vectors = await embedder.embed(texts, signal);
			lastError = null;
			pause = FIRST_PAUSE_MS;
			return vectors;
		} catch (error) {
			if (signal?.aborted) throw new SearchOutboxAbortError();
			lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
			pausedUntil = Date.now() + pause;
			console.error(`Search index embedder failed; records are written without vectors for ${pause / 1_000} s: ${lastError}`);
			pause = Math.min(pause * 2, LONGEST_PAUSE_MS);
			return null;
		}
	}

	return {
		async attach(documents, signal) {
			const texts = documents.map((document) => embeddingText(document));
			const hashes = texts.map((text) => hashOf(embedder.fingerprint, text));
			const stored = await readStored(search, documents.map((document) => document.key), signal);
			const reused = documents.map((document, position) => {
				const kept = stored.get(document.key);
				return kept?.embeddingHash === hashes[position] && usable(kept.embedding) ? kept.embedding : null;
			});
			const missing = reused.flatMap((vector, position) => (vector ? [] : [position]));
			const vectors = await embed(missing.map((position) => texts[position]!), signal);
			const fresh = new Map(missing.map((position, index) => [position, vectors?.[index]]));
			return documents.map((document, position) => {
				const vector = reused[position] ?? fresh.get(position);
				return usable(vector) ? { ...document, embedding: vector, embeddingHash: hashes[position], embeddingModel: embedder.fingerprint } : { ...document };
			});
		},
		async embedMissing(signal) {
			let embedded = 0;
			let after: estypes.SortResults | undefined;
			while (embedded < MISSING_PER_CALL) {
				const hits = (await readMissing(search, after, signal)).hits.hits;
				if (hits.length === 0) break;
				const texts = hits.map((hit) => embeddingText(hit._source ?? {}));
				const vectors = await embed(texts, signal);
				if (!vectors) break;
				// Only a record unchanged since it was read takes the vector: one written meanwhile has its own.
				const operations = hits.flatMap((hit, position) =>
					usable(vectors[position])
						? [
								{ update: { _index: hit._index, _id: hit._id!, if_seq_no: hit._seq_no!, if_primary_term: hit._primary_term! } },
								{ doc: { embedding: vectors[position], embeddingHash: hashOf(embedder.fingerprint, texts[position]!), embeddingModel: embedder.fingerprint } },
							]
						: [],
				);
				const refused = operations.length > 0 ? refusedUpdates(await search.client.bulk({ operations }, { signal })) : [];
				if (refused.length > 0) console.error(`Search index: ${refused.length} vector(s) were refused: ${refused.slice(0, 3).join("; ")}`);
				embedded += hits.length - refused.length;
				after = hits.at(-1)!.sort;
				if (hits.length < MISSING_PAGE) break;
			}
			return embedded;
		},
		lastError: () => lastError,
	};
}
