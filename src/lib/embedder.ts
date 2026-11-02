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
 * Texts in one request and requests in flight at once to one embedder, whoever asks: every claim the worker drains
 * shares them. Unless set, a REST embedder gets 128 requests of 50 texts, the fastest of 13 settings OpenRouter's
 * Perplexity model answered (3,005 records a second, 29 October 2026), and OpenAI, which takes 2,048, 64 texts. A model
 * on a few CPU cores needs about 8 requests of 10: `SEARCH_EMBEDDER_PARALLEL_REQUESTS` and `SEARCH_EMBEDDER_BATCH_TEXTS`
 * set them for the worker, up to Perplexity's 512 texts. A batch stays under 256 KB, below Perplexity's 120,000 tokens.
 */
const REST_BATCH_TEXTS = 50;
const OPENAI_BATCH_TEXTS = 64;
export const MOST_BATCH_TEXTS = 512;
const BATCH_BYTES = 256 * 1024;
const PARALLEL_REQUESTS = 128;
export const MOST_PARALLEL_REQUESTS = 512;

/** A worker setting: undefined when unset, else a whole number from 1 to `most`. */
function wholeNumberSetting(name: string, value: string | undefined, most: number) {
	if (value === undefined || value.trim() === "") return undefined;
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1 || number > most) throw new Error(`${name} must be a whole number from 1 to ${most}.`);
	return number;
}

/** The worker's requests in flight from `SEARCH_EMBEDDER_PARALLEL_REQUESTS`: 128 when unset, else 1 to 512. */
export function embedderParallelRequests(value: string | undefined) {
	return wholeNumberSetting("SEARCH_EMBEDDER_PARALLEL_REQUESTS", value, MOST_PARALLEL_REQUESTS) ?? PARALLEL_REQUESTS;
}

/** The worker's texts a request from `SEARCH_EMBEDDER_BATCH_TEXTS`: the embedder's own when unset, else 1 to 512. */
export function embedderBatchTexts(value: string | undefined) {
	return wholeNumberSetting("SEARCH_EMBEDDER_BATCH_TEXTS", value, MOST_BATCH_TEXTS);
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

/** How long a busy service asks to be left alone (`Retry-After`, in seconds or as a date). */
function retryAfterMs(header: string | null) {
	if (!header) return undefined;
	const seconds = Number(header);
	if (Number.isFinite(seconds)) return seconds * 1_000;
	const at = Date.parse(header);
	return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/**
 * The wait before another try: the step, spread so that requests failed together don't come back together, or longer
 * when the service asks, up to a minute.
 */
function retryWait(step: number, askedMs: number | undefined) {
	return Math.min(Math.max(step * (0.5 + Math.random()), askedMs ?? 0), 60_000);
}

async function post(call: Call, signal: AbortSignal | undefined) {
	const response = await fetch(call.url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...call.headers },
		body: JSON.stringify(call.body),
		signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	const text = await response.text().catch(() => "");
	if (response.ok) {
		try {
			return { answer: JSON.parse(text) as unknown };
		} catch {
			return { failure: `${response.status} with an answer that isn't JSON: ${text.slice(0, 300)}`, retry: false };
		}
	}
	const failure = `${response.status} ${text.slice(0, 300)}`;
	return { failure, retry: retryable(response.status), refused: refusesTexts(response.status), retryAfter: retryAfterMs(response.headers.get("retry-after")) };
}

/** The text without the embedder's secrets: its key, and its header values, which can hold one. */
function scrubbed(text: string, secrets: Secrets) {
	const withoutKey = secrets.key ? text.replaceAll(secrets.key, "[key]") : text;
	return secrets.headerValues.reduce((result, value) => result.replaceAll(value, "[header]"), withoutKey);
}

type Secrets = { key: string | undefined; headerValues: readonly string[] };

/** One request, tried again after a busy answer, a server error or a lost connection. */
async function send(call: Call, signal: AbortSignal | undefined, secrets: Secrets) {
	type Outcome = Awaited<ReturnType<typeof post>> | ReturnType<typeof unanswered>;
	let outcome: Outcome = { failure: "", retry: true };
	for (const [attempt, step] of [0, ...RETRY_DELAYS_MS].entries()) {
		if (attempt > 0) await delay(retryWait(step, "retryAfter" in outcome ? outcome.retryAfter : undefined), undefined, { signal });
		signal?.throwIfAborted();
		outcome = await post(call, signal).catch((error: unknown) => {
			if (signal?.aborted) throw error;
			return unanswered(error);
		});
		if ("answer" in outcome || !outcome.retry) break;
	}
	if ("answer" in outcome) return outcome.answer;
	// An answer can quote what it was sent; the key never goes further.
	const failure = scrubbed(outcome.failure, secrets);
	if ("refused" in outcome && outcome.refused) throw new RefusedTexts(failure);
	throw new EmbedderError(`The embedder failed: ${failure}`);
}

/**
 * What makes an embedder's vectors: everything but its key and the values of its headers, which can hold secrets.
 * Header names count, as a header can choose the model; a change to a header's value keeps the old vectors.
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

/** Texts in one request: `batchTexts` if set, else the embedder's own; one for a template that sends one. */
function textsPerRequest(configuration: EmbedderConfiguration, batchTexts: number | undefined) {
	if (configuration.source === "openAi") return batchTexts ?? OPENAI_BATCH_TEXTS;
	return sendsBatches(configuration.request) ? (batchTexts ?? REST_BATCH_TEXTS) : 1;
}

/** The library's embedder, or null when it has none; `parallelRequests` requests in flight at once, of `batchTexts` texts. */
export function createEmbedder(
	configuration: LibraryServerConfig["search"]["embedder"],
	{ parallelRequests = PARALLEL_REQUESTS, batchTexts }: { parallelRequests?: number; batchTexts?: number } = {},
): Embedder | null {
	if (!configuration) return null;
	const call = (texts: readonly string[]) => (configuration.source === "openAi" ? openAiCall(configuration, texts) : restCall(configuration, texts));
	const batchSize = textsPerRequest(configuration, batchTexts);
	const inTurn = limiter(parallelRequests);
	// Header values short enough to turn up in ordinary words can't be a secret worth hiding.
	const secrets: Secrets = {
		key: configuration.apiKey,
		headerValues: Object.values(configuration.source === "rest" ? (configuration.headers ?? {}) : {}).filter((value) => value.length >= 8),
	};
	// What the embedder said when it last refused texts, for a call where it refused them all.
	let lastRefusal = "";

	/** Vectors for one batch; a refused batch is split in halves to find the texts the embedder refuses. */
	const embedBatch = async (texts: readonly string[], signal: AbortSignal): Promise<Array<number[] | null>> => {
		const request = call(texts);
		try {
			const answer = await inTurn(() => {
				signal.throwIfAborted();
				return send(request, signal, secrets);
			});
			const vectors = request.read(answer);
			if (vectors.length !== texts.length || !vectors.every((vector) => isVector(vector, configuration.dimensions))) {
				const said = scrubbed(JSON.stringify(answer).slice(0, 300), secrets);
				throw new EmbedderError(`The embedder answered ${vectors.length} vector(s) for ${texts.length} text(s), or a vector that isn't ${configuration.dimensions ?? "a list of"} numbers: ${said}`);
			}
			return vectors as number[][];
		} catch (error) {
			if (!(error instanceof RefusedTexts)) throw error;
			lastRefusal = error.message;
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
			const answers = (
				await Promise.all(
					batches(texts, batchSize).map((batch) =>
						embedBatch(batch, lanes).catch((error: unknown) => {
							stop.abort();
							throw error;
						}),
					),
				)
			).flat();
			// Every text refused is a request the embedder can't read, such as a wrong template or model, not bad texts.
			if (texts.length > 1 && answers.every((vector) => vector === null)) {
				throw new EmbedderError(`The embedder refused all ${texts.length} texts, so the request itself is likely wrong: ${lastRefusal}`);
			}
			return answers;
		},
	};
}
