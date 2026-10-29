import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type { LibraryServerConfig } from "@/config/library-config/schema";

/**
 * The library's embedder, called by Evidence Library itself for Elasticsearch (OpenDevEd/new-el#720): Elasticsearch's
 * free licence stores and searches vectors but can't call an embedding service. Meilisearch calls the same embedder
 * by itself. The configuration keeps Meilisearch's shape: OpenAI, or a REST service described by a request template
 * holding `{{text}}` and a response template holding `{{embedding}}`, where `["…", "{{..}}"]` repeats an entry for
 * each text of a batch.
 */

export type EmbedderConfiguration = NonNullable<LibraryServerConfig["search"]["embedder"]>;

export type Embedder = {
	/** Changes when the embedder would give other vectors for the same text; its key isn't part of it. */
	readonly fingerprint: string;
	/** How many texts it embeds at once: requests in flight times texts a request. */
	readonly capacity: number;
	/**
	 * One vector for each text, in order, or null for a text the embedder refuses, as one too long for it. Throws
	 * `EmbedderError` when the embedder fails as a whole: a refused key, no answer, or an answer that holds no vectors.
	 */
	embed(texts: readonly string[], signal?: AbortSignal): Promise<Array<number[] | null>>;
};

/** The embedder failed, or answered something that isn't a vector for each text. */
export class EmbedderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EmbedderError";
	}
}

/** The embedder refused what it was sent, not the request itself: one of the texts, or how many there were. */
class RefusedTexts extends Error {}

const TEXT = "{{text}}";
const EMBEDDING = "{{embedding}}";
const REPEAT = "{{..}}";

const OPENAI_URL = "https://api.openai.com/v1/embeddings";

/**
 * Texts in one request: as many as Meilisearch sends a REST embedder, and more to OpenAI, which takes 2,048. A batch
 * stays under 256 KB, far below Perplexity's 120,000 tokens.
 */
const REST_BATCH_TEXTS = 10;
const OPENAI_BATCH_TEXTS = 64;
const BATCH_BYTES = 256 * 1024;

/**
 * Requests in flight at once to one embedder, whoever asks: every claim the worker drains shares them. A hosted service
 * takes many more than a model on a few CPU cores; `SEARCH_EMBEDDER_PARALLEL_REQUESTS` sets it for the worker.
 */
const PARALLEL_REQUESTS = 8;
export const MOST_PARALLEL_REQUESTS = 128;

/** The worker's requests in flight from `SEARCH_EMBEDDER_PARALLEL_REQUESTS`: 8 when unset, else 1 to 128. */
export function embedderParallelRequests(value: string | undefined) {
	if (value === undefined || value.trim() === "") return PARALLEL_REQUESTS;
	const requests = Number(value);
	if (!Number.isSafeInteger(requests) || requests < 1 || requests > MOST_PARALLEL_REQUESTS) {
		throw new Error(`SEARCH_EMBEDDER_PARALLEL_REQUESTS must be a whole number from 1 to ${MOST_PARALLEL_REQUESTS}.`);
	}
	return requests;
}

/** A self-hosted model on CPU embeds about 3 records a second, so a batch can take tens of seconds. */
const REQUEST_TIMEOUT_MS = 120_000;
/** Waits before each retry of a request the service answered busy or failed: 1, 2, 4 and 8 seconds. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

function contains(value: unknown, placeholder: string): boolean {
	if (typeof value === "string") return value.includes(placeholder);
	if (Array.isArray(value)) return value.some((entry) => contains(entry, placeholder));
	return value !== null && typeof value === "object" && Object.values(value).some((entry) => contains(entry, placeholder));
}

/** `[entry, "{{..}}"]`: `entry` once for each text of a batch, or each vector of an answer. */
function repeated(value: unknown, placeholder: string): value is [unknown, typeof REPEAT] {
	return Array.isArray(value) && value.length === 2 && value[1] === REPEAT && contains(value[0], placeholder);
}

/** Whether the request template sends several texts at once. */
function sendsBatches(template: unknown): boolean {
	if (repeated(template, TEXT)) return true;
	if (Array.isArray(template)) return template.some(sendsBatches);
	return template !== null && typeof template === "object" && Object.values(template).some(sendsBatches);
}

/** The request body for `texts`: all of them in a batch template, else the one text. */
export function requestBody(template: unknown, texts: readonly string[]): unknown {
	if (typeof template === "string") return template === TEXT ? texts[0] : template.replaceAll(TEXT, texts[0] ?? "");
	if (repeated(template, TEXT)) return texts.map((text) => requestBody(template[0], [text]));
	if (Array.isArray(template)) return template.map((entry) => requestBody(entry, texts));
	if (template === null || typeof template !== "object") return template;
	return Object.fromEntries(Object.entries(template).map(([name, entry]) => [name, requestBody(entry, texts)]));
}

/** The vectors in an answer, found where the response template holds `{{embedding}}`. */
export function answerVectors(template: unknown, answer: unknown): unknown[] {
	if (template === EMBEDDING) return [answer];
	if (repeated(template, EMBEDDING)) return Array.isArray(answer) ? answer.flatMap((entry) => answerVectors(template[0], entry)) : [];
	if (template === null || typeof template !== "object" || answer === null || typeof answer !== "object") return [];
	const [name, entry] = Object.entries(template).find(([, value]) => contains(value, EMBEDDING)) ?? [];
	return name === undefined ? [] : answerVectors(entry, (answer as Record<string, unknown>)[name]);
}

function isVector(value: unknown, dimensions: number | undefined): value is number[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		(dimensions === undefined || value.length === dimensions) &&
		value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
	);
}

/** Texts in requests of at most `size` texts and `BATCH_BYTES` bytes. */
function batches(texts: readonly string[], size: number) {
	const result: string[][] = [];
	let batch: string[] = [];
	let bytes = 0;
	for (const text of texts) {
		const length = Buffer.byteLength(text, "utf8");
		if (batch.length > 0 && (batch.length >= size || bytes + length > BATCH_BYTES)) {
			result.push(batch);
			batch = [];
			bytes = 0;
		}
		batch.push(text);
		bytes += length;
	}
	if (batch.length > 0) result.push(batch);
	return result;
}

type Call = { url: string; headers: Record<string, string>; body: unknown; read: (answer: unknown) => unknown[] };

function restCall(embedder: Extract<EmbedderConfiguration, { source: "rest" }>, texts: readonly string[]): Call {
	return {
		url: embedder.url,
		headers: { ...(embedder.apiKey ? { Authorization: `Bearer ${embedder.apiKey}` } : {}), ...embedder.headers },
		body: requestBody(embedder.request, texts),
		read: (answer) => answerVectors(embedder.response, answer),
	};
}

function openAiCall(embedder: Extract<EmbedderConfiguration, { source: "openAi" }>, texts: readonly string[]): Call {
	// Only the text-embedding-3 models take a size; OpenAI refuses it for older ones, as Meilisearch knows.
	const sized = embedder.dimensions && embedder.model.startsWith("text-embedding-3");
	return {
		url: OPENAI_URL,
		headers: { Authorization: `Bearer ${embedder.apiKey}` },
		body: { model: embedder.model, input: texts, encoding_format: "float", ...(sized ? { dimensions: embedder.dimensions } : {}) },
		read: (answer) =>
			[...((answer as { data?: Array<{ index: number; embedding: unknown }> }).data ?? [])]
				.sort((left, right) => left.index - right.index)
				.map((entry) => entry.embedding),
	};
}

/**
 * A busy or failing service is worth another try, as is OpenRouter's 402: an account out of credit, or over its budget
 * for paid requests in flight (https://openrouter.ai/docs/api-reference/limits).
 */
function retryable(status: number) {
	return status === 402 || status === 429 || status >= 500;
}

/** A refusal of what was sent, which a smaller batch or another text may pass; not of the key or the account, nor a busy service. */
function refusesTexts(status: number) {
	return status >= 400 && status < 500 && ![401, 402, 403, 404, 407, 408, 429].includes(status);
}

/**
 * Why a request got no answer, without the error's own words: a header error quotes the header, key and all. Only a
 * lost connection is tried again; a request that ran out of time may still be running, and sending it again would
 * only add to the embedder's work.
 */
function unanswered(error: unknown) {
	if (error instanceof Error && error.name === "TimeoutError") return { failure: `no answer within ${REQUEST_TIMEOUT_MS / 1_000} s`, retry: false };
	if (error instanceof TypeError && error.message === "fetch failed") {
		return { failure: `no connection (${(error.cause as { code?: string } | undefined)?.code ?? "network error"})`, retry: true };
	}
	return { failure: `the request couldn't be sent (${error instanceof Error ? error.name : "error"}); check the embedder's URL, key and headers`, retry: false };
}

async function post(call: Call, signal: AbortSignal | undefined) {
	const response = await fetch(call.url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...call.headers },
		body: JSON.stringify(call.body),
		signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (response.ok) return { answer: (await response.json()) as unknown };
	const failure = `${response.status} ${(await response.text().catch(() => "")).slice(0, 300)}`;
	return { failure, retry: retryable(response.status), refused: refusesTexts(response.status) };
}

/** One request, tried again after a busy answer, a server error or a lost connection. */
async function send(call: Call, signal: AbortSignal | undefined, secret: string | undefined) {
	let outcome: Awaited<ReturnType<typeof post>> | ReturnType<typeof unanswered> = { failure: "", retry: true };
	for (const wait of [0, ...RETRY_DELAYS_MS]) {
		if (wait > 0) await delay(wait, undefined, { signal });
		signal?.throwIfAborted();
		outcome = await post(call, signal).catch((error: unknown) => {
			if (signal?.aborted) throw error;
			return unanswered(error);
		});
		if ("answer" in outcome || !outcome.retry) break;
	}
	if ("answer" in outcome) return outcome.answer;
	// An answer can quote what it was sent; the key never goes further.
	const failure = secret ? outcome.failure.replaceAll(secret, "[key]") : outcome.failure;
	if ("refused" in outcome && outcome.refused) throw new RefusedTexts(failure);
	throw new EmbedderError(`The embedder failed: ${failure}`);
}

/**
 * What makes an embedder's vectors: everything but its key and the values of its headers, which can hold secrets.
 * Header names count, as a header can choose the model.
 */
export function embedderFingerprint(embedder: EmbedderConfiguration) {
	const { source, dimensions } = embedder;
	const described =
		embedder.source === "openAi"
			? { source, dimensions, model: embedder.model }
			: { source, dimensions, url: embedder.url, request: embedder.request, response: embedder.response, headers: Object.keys(embedder.headers ?? {}).sort() };
	return createHash("sha256").update(JSON.stringify(described)).digest("hex").slice(0, 16);
}

/** Runs at most `size` tasks at once; a task that finishes hands its place to the next one waiting. */
function limiter(size: number) {
	let active = 0;
	const waiting: Array<() => void> = [];
	return async <T>(task: () => Promise<T>) => {
		if (active < size) active += 1;
		else await new Promise<void>((resolve) => waiting.push(resolve));
		try {
			return await task();
		} finally {
			const next = waiting.shift();
			if (next) next();
			else active -= 1;
		}
	};
}

/** The library's embedder, or null when it has none; `parallelRequests` requests in flight at once. */
export function createEmbedder(
	configuration: LibraryServerConfig["search"]["embedder"],
	{ parallelRequests = PARALLEL_REQUESTS }: { parallelRequests?: number } = {},
): Embedder | null {
	if (!configuration) return null;
	const call = (texts: readonly string[]) => (configuration.source === "openAi" ? openAiCall(configuration, texts) : restCall(configuration, texts));
	const batchSize = configuration.source === "openAi" ? OPENAI_BATCH_TEXTS : sendsBatches(configuration.request) ? REST_BATCH_TEXTS : 1;
	const inTurn = limiter(parallelRequests);

	/** Vectors for one batch; a refused batch is split in halves to find the texts the embedder refuses. */
	const embedBatch = async (texts: readonly string[], signal: AbortSignal): Promise<Array<number[] | null>> => {
		const request = call(texts);
		try {
			const answer = await inTurn(() => {
				signal.throwIfAborted();
				return send(request, signal, configuration.apiKey);
			});
			const vectors = request.read(answer);
			if (vectors.length !== texts.length || !vectors.every((vector) => isVector(vector, configuration.dimensions))) {
				throw new EmbedderError(`The embedder answered ${vectors.length} vector(s) for ${texts.length} text(s), or a vector that isn't ${configuration.dimensions ?? "a list of"} numbers.`);
			}
			return vectors as number[][];
		} catch (error) {
			if (!(error instanceof RefusedTexts)) throw error;
			if (texts.length === 1) return [null];
			const half = Math.ceil(texts.length / 2);
			const [first, second] = await Promise.all([embedBatch(texts.slice(0, half), signal), embedBatch(texts.slice(half), signal)]);
			return [...first, ...second];
		}
	};

	return {
		fingerprint: embedderFingerprint(configuration),
		capacity: parallelRequests * batchSize,
		async embed(texts, signal) {
			// The first failure stops the call's other requests, which would only fail the same way.
			const stop = new AbortController();
			const lanes = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
			const answers = await Promise.all(
				batches(texts, batchSize).map((batch) =>
					embedBatch(batch, lanes).catch((error: unknown) => {
						stop.abort();
						throw error;
					}),
				),
			);
			return answers.flat();
		},
	};
}
