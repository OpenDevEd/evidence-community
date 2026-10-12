import { z } from "zod";
import type { readingQuestions } from "./questions";

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
/** Pinned, so a new Jev never changes answers unannounced; the model is stored with every read. */
const JEV_MODEL = "typesafe/jev-1.13";
const TIMEOUT_MS = 60_000;

const responseSchema = z.object({
	model: z.string().optional(),
	answers: z.record(z.string(), z.unknown()),
	usage: z.object({ input_tokens: z.number(), cost: z.number().optional() }),
});

/** A Jev call that did not answer, with what OpenRouter said, for the queue's `lastError` and the log. */
class JevError extends Error {
	constructor(readonly status: number, detail: string) {
		super(`Jev returned ${status}: ${detail.slice(0, 500)}`);
		this.name = "JevError";
	}
}

/**
 * Asks Jev the questions about one record through OpenRouter's Decisions API, on the library's own key. Jev charges
 * for input only, so every question about the record goes in one call.
 */
export async function askJev(
	{ apiKey, state, questions, signal, request = fetch }: {
		apiKey: string;
		state: { title: string; abstract?: string };
		questions: ReturnType<typeof readingQuestions>;
		signal?: AbortSignal;
		request?: typeof fetch;
	},
) {
	const response = await request(DECISIONS_URL, {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "OpenScholar Evidence Library" },
		body: JSON.stringify({ model: JEV_MODEL, state, questions }),
		signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) throw new JevError(response.status, await response.text().catch(() => ""));
	const body = responseSchema.parse(await response.json());
	return { answers: body.answers, model: body.model ?? JEV_MODEL, usd: body.usage.cost ?? 0, inputTokens: body.usage.input_tokens };
}
