import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/telemetry", () => ({ trackAIUsage: vi.fn(async () => {}) }));
// The library's search and PDF store stand behind the tools; the agent only
// needs their results, in the shape the real tools return.
vi.mock("@/lib/ai/tools", async () => {
	const { tool } = await import("ai");
	return {
		createResearchTools: () => ({
			searchLibrary: tool({
				description: "Search the library.",
				inputSchema: z.object({ queries: z.array(z.string()) }),
				execute: async ({ queries }) => ({
					queries: queries.map((query) => ({ query, hits: [{ key: "KHAN1", hasPdf: true }] })),
				}),
			}),
			readPublications: tool({
				description: "Read publications.",
				inputSchema: z.object({ itemKeys: z.array(z.string()) }),
				execute: async ({ itemKeys }) => ({ requestedItemKeys: itemKeys }),
				toModelOutput: async () => ({
					type: "content" as const,
					value: [
						{ type: "text" as const, text: "Publication KHAN1." },
						{ type: "file-data" as const, data: "JVBERi0=", mediaType: "application/pdf", filename: "khan.pdf" },
					],
				}),
			}),
		}),
	};
});

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createResearchAgent, researchStepLimit } from "@/lib/ai/agent";

const CLAUDE = "anthropic/claude-haiku-5.5";

/** One streamed OpenRouter reply: a tool call, or the answer on the last step. */
function reply(step: number, lastStep: number) {
	const toolName = step === 2 ? "readPublications" : "searchLibrary";
	const delta =
		step === lastStep
			? { role: "assistant", content: "Answer." }
			: {
					role: "assistant",
					tool_calls: [{
						index: 0,
						id: `call_${step}`,
						type: "function",
						function: {
							name: toolName,
							arguments: JSON.stringify(toolName === "readPublications" ? { itemKeys: ["KHAN1"] } : { queries: [`query ${step}`] }),
						},
					}],
				};
	const base = { id: `gen-${step}`, object: "chat.completion.chunk", created: 1, model: CLAUDE };
	return [
		{ ...base, choices: [{ index: 0, delta, finish_reason: null }] },
		{
			...base,
			choices: [{ index: 0, delta: {}, finish_reason: step === lastStep ? "stop" : "tool_calls" }],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		},
	].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
}

function cacheMarks(value: unknown): number {
	if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + cacheMarks(item), 0);
	if (!value || typeof value !== "object") return 0;
	return Object.entries(value).reduce(
		(sum, [key, child]) => sum + (key === "cache_control" ? (child == null ? 0 : 1) : cacheMarks(child)),
		0,
	);
}

/** Runs a chat that uses a tool on every step it may take, and returns each request OpenRouter received. */
async function requestsOfLongChat(mode: "quick" | "research") {
	const lastStep = researchStepLimit(mode);
	const bodies: Array<Record<string, unknown>> = [];
	const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
		bodies.push(JSON.parse(String(init?.body)));
		return new Response(reply(bodies.length, lastStep), { headers: { "content-type": "text/event-stream" } });
	};
	const openRouter = createOpenRouter({ apiKey: "test", compatibility: "strict", fetch });
	const agent = createResearchAgent({
		config: {} as never,
		mode,
		selectedModel: {
			provider: "openrouter",
			modelId: CLAUDE,
			createModel: (modelId: string, settings?: object) => openRouter.languageModel(modelId, settings),
		} as never,
		locale: "en-GB",
		companyName: "AIED",
		sessionId: "chat:test",
		startedAt: Date.now(),
	});
	const result = await agent.stream({ messages: [{ role: "user", content: "Summarise Khan Academy's impact on maths." }] });
	for await (const part of result.stream) {
		if (part.type === "error") throw part.error;
	}
	return bodies;
}

describe("Claude prompt caching in a long chat", () => {
	// Anthropic refuses a request with more than four cache_control blocks:
	// "A maximum of 4 blocks with cache_control may be provided."
	it.each(["quick", "research"] as const)("keeps every %s request within Anthropic's four cache marks", async (mode) => {
		const requests = await requestsOfLongChat(mode);

		expect(requests).toHaveLength(researchStepLimit(mode));
		for (const request of requests) {
			expect(request.cache_control).toMatchObject({ type: "ephemeral" });
			expect(cacheMarks(request)).toBeLessThanOrEqual(4);
		}
	});
});
