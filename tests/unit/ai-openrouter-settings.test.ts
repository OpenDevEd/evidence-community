import { describe, expect, it } from "vitest";

import {
	OPENROUTER_RESPONSE_CACHE_TTL,
	openRouterCacheBreakpoint,
	openRouterModelSettings,
	openRouterMaximumReasoningSettings,
	openRouterResponseCacheHeaders,
	openRouterSessionId,
} from "@/lib/ai/openrouter";

describe("gateway settings for a request", () => {
	it("uses current provider defaults for new catalog models and keeps Luna's fixed effort", () => {
		expect(
			openRouterModelSettings(
				"openrouter",
				"deepseek/deepseek-v4.1-flash",
				{ sessionId: "chat:test" },
			),
		).toEqual({
			usage: { include: true },
			extraBody: { session_id: "chat:test" },
		});
		expect(
			openRouterMaximumReasoningSettings(
				"openrouter",
				"deepseek/deepseek-v4.1-flash",
				{},
			),
		).toBeUndefined();
		expect(
			openRouterMaximumReasoningSettings(
				"openrouter",
				"openai/gpt-6-luna",
				{},
			),
		).toMatchObject({ extraBody: { reasoning: { effort: "max" } } });
	});
	it("prefers the hosts a model needs and reports its cost", () => {
		const settings = openRouterModelSettings(
			"openrouter",
			"openai/gpt-6-luna",
		);

		expect(settings).toMatchObject({
			usage: { include: true },
			provider: {
				order: ["amazon-bedrock/us-east-1"],
				allow_fallbacks: true,
			},
		});
		expect(settings).not.toHaveProperty("cache_control");
	});

	it("keeps every Gemini request on one Google host, because its thought signatures only work there", () => {
		expect(
			openRouterModelSettings("openrouter", "google/gemini-3.8-flash"),
		).toMatchObject({
			provider: { only: ["google-ai-studio"], allow_fallbacks: false },
		});
		expect(
			openRouterModelSettings("openrouter", "deepseek/deepseek-v4.1-flash"),
		).not.toHaveProperty("provider");
	});

	it.each(["anthropic/claude-opus-5", "~anthropic/claude-sonnet-5"])("caches %s explicitly for an hour", (modelId) => {
		const settings = openRouterModelSettings(
			"openrouter",
			modelId,
		);

		expect(settings).toMatchObject({
			cache_control: { type: "ephemeral", ttl: "1h" },
		});
		expect(
			openRouterCacheBreakpoint("openrouter", modelId),
		).toEqual({
			openrouter: { cacheControl: { type: "ephemeral", ttl: "1h" } },
		});
		expect(
			openRouterCacheBreakpoint("openrouter", "openai/gpt-6-luna"),
		).toBeUndefined();
	});

	it("stays out of the way when the library uses its own provider key", () => {
		expect(openRouterModelSettings("google", "gemini-2.5-pro")).toEqual({});
		expect(
			openRouterCacheBreakpoint("google", "gemini-2.5-pro"),
		).toBeUndefined();
	});

	it("keeps one conversation on one cached session", () => {
		const first = openRouterSessionId("chat", "conversation-1");

		expect(first).toBe(openRouterSessionId("chat", "conversation-1"));
		expect(first).not.toBe(openRouterSessionId("chat", "conversation-2"));
		expect(first.startsWith("chat:")).toBe(true);
	});

	it("asks the gateway to reuse a repeated answer for its feature's window", () => {
		expect(
			openRouterResponseCacheHeaders(
				OPENROUTER_RESPONSE_CACHE_TTL.questions,
			),
		).toEqual({
			"X-OpenRouter-Cache": "true",
			"X-OpenRouter-Cache-TTL": "86400",
		});
		expect(
			openRouterResponseCacheHeaders(OPENROUTER_RESPONSE_CACHE_TTL.chat, {
				refresh: true,
			}),
		).toMatchObject({ "X-OpenRouter-Cache-Clear": "true" });
	});
});
