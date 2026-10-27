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
	/** One vector for each text, in order. */
	embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>;
};

/** The embedder failed or answered something that isn't a vector for each text. */
export class EmbedderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EmbedderError";
	}
}

const TEXT = "{{text}}";
const EMBEDDING = "{{embedding}}";
const REPEAT = "{{..}}";

const OPENAI_URL = "https://api.openai.com/v1/embeddings";

/** Texts in one request, and their size: under Perplexity's 512 texts and 120,000 tokens, and OpenAI's limits. */
const BATCH_TEXTS = 64;
const BATCH_BYTES = 256 * 1024;

/** Requests in flight at once while embedding many texts. */
const PARALLEL_REQUESTS = 4;

/** A self-hosted model on CPU embeds about 3 records a second, so a batch of 64 can take most of this. */
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

/** Texts in requests of at most `BATCH_TEXTS` texts and `BATCH_BYTES` bytes; one text alone when the template sends one. */
function batches(texts: readonly string[], batched: boolean) {
	if (!batched) return texts.map((text) => [text]);
	const result: string[][] = [];
	let batch: string[] = [];
	let bytes = 0;
	for (const text of texts) {
		const size = Buffer.byteLength(text, "utf8");
		if (batch.length > 0 && (batch.length >= BATCH_TEXTS || bytes + size > BATCH_BYTES)) {
			result.push(batch);
			batch = [];
			bytes = 0;
		}
		batch.push(text);
		bytes += size;
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
	return {
		url: OPENAI_URL,
		headers: { Authorization: `Bearer ${embedder.apiKey}` },
		body: { model: embedder.model, input: texts, encoding_format: "float", ...(embedder.dimensions ? { dimensions: embedder.dimensions } : {}) },
		read: (answer) =>
			[...((answer as { data?: Array<{ index: number; embedding: unknown }> }).data ?? [])]
				.sort((left, right) => left.index - right.index)
				.map((entry) => entry.embedding),
	};
}

/** A busy or failing service, or a network error, is worth another try; any other refusal is not. */
function retryable(status: number) {
	return status === 408 || status === 429 || status >= 500;
}

async function post(call: Call, signal: AbortSignal | undefined) {
	const response = await fetch(call.url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...call.headers },
		body: JSON.stringify(call.body),
		signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (response.ok) return { answer: (await response.json()) as unknown };
	const reason = `${response.status} ${(await response.text().catch(() => "")).slice(0, 300)}`;
	return { failure: reason, retry: retryable(response.status) };
}

/** One request, tried again after a busy answer, a server error or a network error. */
async function send(call: Call, signal: AbortSignal | undefined) {
	let failure = "";
	for (const wait of [0, ...RETRY_DELAYS_MS]) {
		if (wait > 0) await delay(wait, undefined, { signal });
		signal?.throwIfAborted();
		const outcome = await post(call, signal).catch((error: unknown) => {
			if (signal?.aborted) throw error;
			return { failure: error instanceof Error ? error.message : String(error), retry: true };
		});
		if ("answer" in outcome) return outcome.answer;
		failure = outcome.failure;
		if (!outcome.retry) break;
	}
	throw new EmbedderError(`The embedder failed: ${failure}`);
}

/** What makes an embedder's vectors: everything but its key and headers, which can hold secrets. */
export function embedderFingerprint(embedder: EmbedderConfiguration) {
	const { source, dimensions } = embedder;
	const described = embedder.source === "openAi" ? { source, dimensions, model: embedder.model } : { source, dimensions, url: embedder.url, request: embedder.request, response: embedder.response };
	return createHash("sha256").update(JSON.stringify(described)).digest("hex").slice(0, 16);
}

/** Runs `work` on each item, `limit` at a time, keeping the order; after a failure no more items start. */
async function inParallel<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>) {
	const results: R[] = new Array(items.length);
	let next = 0;
	let failed = false;
	const lane = async () => {
		while (next < items.length && !failed) {
			const position = next++;
			results[position] = await work(items[position]!).catch((error: unknown) => {
				failed = true;
				throw error;
			});
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
	return results;
}

/** The library's embedder, or null when it has none. */
export function createEmbedder(configuration: LibraryServerConfig["search"]["embedder"]): Embedder | null {
	if (!configuration) return null;
	const call = (texts: readonly string[]) => (configuration.source === "openAi" ? openAiCall(configuration, texts) : restCall(configuration, texts));
	const batched = configuration.source === "openAi" || sendsBatches(configuration.request);
	const embedBatch = async (texts: readonly string[], signal?: AbortSignal) => {
		const request = call(texts);
		const vectors = request.read(await send(request, signal));
		if (vectors.length !== texts.length || !vectors.every((vector) => isVector(vector, configuration.dimensions))) {
			throw new EmbedderError(`The embedder answered ${vectors.length} vector(s) for ${texts.length} text(s), or a vector that isn't ${configuration.dimensions ?? "a list of"} numbers.`);
		}
		return vectors as number[][];
	};
	return {
		fingerprint: embedderFingerprint(configuration),
		async embed(texts, signal) {
			const answers = await inParallel(batches(texts, batched), PARALLEL_REQUESTS, (batch) => embedBatch(batch, signal));
			return answers.flat();
		},
	};
}
