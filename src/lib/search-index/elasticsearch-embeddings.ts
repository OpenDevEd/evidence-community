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
 * `embedMissing` embeds them once it answers again. A text the embedder refuses is marked with the hash and embedder
 * alone, so it isn't asked again until the text or the embedder changes.
 */

type Stored = { embedding?: unknown; embeddingHash?: string };

export type ElasticsearchEmbeddings = {
	/**
	 * The documents with their vectors; any the embedder couldn't give are written without one. With `embedNew` false,
	 * as in a rebuild, only stored vectors are reused, and `embedMissing` embeds the rest afterwards.
	 */
	attach(documents: readonly ItemSearchDocument[], signal?: AbortSignal, options?: { embedNew?: boolean }): Promise<ItemSearchDocument[]>;
	/** Embeds records written without a vector, for at most `MISSING_TIME_MS`; returns how many it wrote. */
	embedMissing(signal?: AbortSignal): Promise<number>;
	/** The embedder's last failure, until it answers again. */
	lastError(): string | null;
};

/** The fields the embedding text is made from. */
const TEXT_FIELDS = ["title", "abstractNote", "fullNames", "tags", "year"];

/** After a failure the embedder is left alone this long, doubling up to 30 minutes, and records go without vectors. */
const FIRST_PAUSE_MS = 60_000;
const LONGEST_PAUSE_MS = 30 * 60_000;

/** The most numbers an indexed `dense_vector` holds. */
const MOST_DIMENSIONS = 4_096;

/**
 * How long `embedMissing` may run before the worker drains the outbox again; it checks between pages. A page keeps
 * every request in flight twice over, between 100 and 2,560 records (128 requests of 10 texts): a model on CPU gets
 * small pages, so a page doesn't hold up the drain long, and a hosted service large ones, so its requests don't wait
 * on a page's slowest.
 */
const MISSING_TIME_MS = 30_000;

export function missingPage(embedder: Embedder) {
	return Math.min(2_560, Math.max(100, 2 * embedder.capacity));
}

/** Records one bulk write holds: Elasticsearch takes at most 100 MB a request, and 500 vectors of 4,096 numbers are about 40 MB. */
const WRITE_RECORDS = 500;

function hashOf(fingerprint: string, text: string) {
	return createHash("sha256").update(`${fingerprint}\n${text}`).digest("hex").slice(0, 32);
}

/** A vector Elasticsearch can compare by angle: a zero vector has none. */
function usable(vector: unknown): vector is number[] {
	return Array.isArray(vector) && vector.some((value) => value !== 0);
}

/** An Elasticsearch request that a stop of the worker ends as a stop, not as a failure. */
async function stoppable<T>(request: Promise<T>, signal?: AbortSignal) {
	return request.catch((error: unknown) => {
		if (signal?.aborted) throw new SearchOutboxAbortError();
		throw error;
	});
}

/** The vectors and hashes the library's index holds for these records; none before it has an index. */
async function readStored(search: SearchService, keys: readonly string[], signal?: AbortSignal) {
	if (keys.length === 0) return new Map<string, Stored>();
	const request = search.client.search<Stored>(
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
	const response = await stoppable(request, signal);
	return new Map(response.hits.hits.map((hit) => [String(hit._id), hit._source ?? {}]));
}

/** Records without a vector that this embedder hasn't refused, after `after` in key order, as last written. */
function readMissing(search: SearchService, embedder: Embedder, after: estypes.SortResults | undefined, signal?: AbortSignal) {
	const request = search.client.search<Record<string, unknown>>(
		{
			index: search.alias,
			ignore_unavailable: true,
			size: missingPage(embedder),
			query: { bool: { must_not: [{ exists: { field: "embedding" } }, { term: { embeddingModel: embedder.fingerprint } }] } },
			sort: [{ key: "asc" }],
			...(after ? { search_after: after } : {}),
			seq_no_primary_term: true,
			_source: { includes: TEXT_FIELDS },
		},
		{ signal },
	);
	return stoppable(request, signal);
}

/** Updates that succeeded; one refused because a write came meanwhile is that write's. */
function writtenUpdates(response: estypes.BulkResponse) {
	const refused = response.items.flatMap((item) => {
		const answer = item.update;
		return answer?.error && answer.status !== 409 && answer.status !== 404 ? [`${answer._id}: ${answer.error.type}: ${answer.error.reason ?? ""}`] : [];
	});
	if (refused.length > 0) console.error(`Search index: ${refused.length} vector(s) were refused: ${refused.slice(0, 3).join("; ")}`);
	return response.items.filter((item) => !item.update?.error).length;
}

/** Writes the updates `WRITE_RECORDS` records a request; returns how many succeeded. */
async function writeUpdates(search: SearchService, updates: ReadonlyArray<readonly [object, object]>, signal?: AbortSignal) {
	let written = 0;
	for (let start = 0; start < updates.length; start += WRITE_RECORDS) {
		const operations = updates.slice(start, start + WRITE_RECORDS).flat();
		written += writtenUpdates(await stoppable(search.client.bulk({ operations }, { signal }), signal));
	}
	return written;
}

export function elasticsearchEmbeddings(search: SearchService, embedder: Embedder): ElasticsearchEmbeddings {
	let lastError: string | null = null;
	let pausedUntil = 0;
	let pause = FIRST_PAUSE_MS;

	function failed(reason: string) {
		lastError = reason;
		pausedUntil = Date.now() + pause;
		console.error(`Search index embedder failed; records are written without vectors for ${pause / 1_000} s: ${lastError}`);
		pause = Math.min(pause * 2, LONGEST_PAUSE_MS);
		return null;
	}

	/** Vectors for the texts, null for each the embedder refuses; null for all while the embedder fails. */
	async function embed(texts: readonly string[], signal?: AbortSignal) {
		if (texts.length === 0) return [];
		if (Date.now() < pausedUntil) return null;
		try {
			const vectors = await embedder.embed(texts, signal);
			const longest = Math.max(...vectors.map((vector) => vector?.length ?? 0));
			if (longest > MOST_DIMENSIONS) return failed(`The embedder's vectors have ${longest} numbers; Elasticsearch indexes at most ${MOST_DIMENSIONS}.`);
			const refused = vectors.filter((vector) => !usable(vector)).length;
			lastError = refused > 0 ? `The embedder refused ${refused} of ${texts.length} record text(s); they stay without a vector until their text changes.` : null;
			pausedUntil = 0;
			pause = FIRST_PAUSE_MS;
			return vectors;
		} catch (error) {
			if (signal?.aborted) throw new SearchOutboxAbortError();
			return failed(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
		}
	}

	/** What a record carries for its text: the vector, or for a text the embedder refused, the mark that it did. */
	function embedded(hash: string, vector: unknown) {
		return { ...(usable(vector) ? { embedding: vector } : {}), embeddingHash: hash, embeddingModel: embedder.fingerprint };
	}

	return {
		async attach(documents, signal, { embedNew = true } = {}) {
			const texts = documents.map((document) => embeddingText(document));
			const hashes = texts.map((text) => hashOf(embedder.fingerprint, text));
			const stored = await readStored(search, documents.map((document) => document.key), signal);
			// The same text from the same embedder keeps what it had: its vector, or the mark that the embedder refused it.
			const kept = documents.map((document, position) => stored.get(document.key)?.embeddingHash === hashes[position]);
			const asked = kept.flatMap((same, position) => (same ? [] : [position]));
			const vectors = embedNew ? await embed(asked.map((position) => texts[position]!), signal) : null;
			const fresh = new Map(asked.map((position, index) => [position, vectors?.[index]]));
			return documents.map((document, position) => {
				if (kept[position]) return { ...document, ...embedded(hashes[position]!, stored.get(document.key)!.embedding) };
				// Without an answer, the record is written as it is, and `embedMissing` asks again.
				return vectors ? { ...document, ...embedded(hashes[position]!, fresh.get(position)) } : { ...document };
			});
		},
		async embedMissing(signal) {
			const stopAt = Date.now() + MISSING_TIME_MS;
			let written = 0;
			let after: estypes.SortResults | undefined;
			while (Date.now() < stopAt) {
				const hits = (await readMissing(search, embedder, after, signal)).hits.hits;
				if (hits.length === 0) break;
				const texts = hits.map((hit) => embeddingText(hit._source ?? {}));
				const vectors = await embed(texts, signal);
				if (!vectors) break;
				// Only a record unchanged since it was read takes the vector: one written meanwhile has its own.
				const updates = hits.map((hit, position) => [
					{ update: { _index: hit._index, _id: hit._id!, if_seq_no: hit._seq_no!, if_primary_term: hit._primary_term! } },
					{ doc: embedded(hashOf(embedder.fingerprint, texts[position]!), vectors[position]) },
				] as const);
				written += await writeUpdates(search, updates, signal);
				after = hits.at(-1)!.sort;
				if (hits.length < missingPage(embedder)) break;
			}
			return written;
		},
		lastError: () => lastError,
	};
}
