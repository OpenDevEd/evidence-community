import { createHash } from "node:crypto";

import { getAIModel, type AIModelId, type AIProvider } from "./models";

/**
 * How long the gateway may reuse an identical response, per feature. Chat
 * changes with every message; starter questions for a publication do not.
 */
export const OPENROUTER_RESPONSE_CACHE_TTL = {
	chat: 300,
	publication: 3_600,
	questions: 86_400,
	screening: 3_600,
} as const;

/** Groups related requests so the gateway can reuse their cached prompt. */
export function openRouterSessionId(scope: string, ...parts: string[]) {
	const digest = createHash("sha256")
		.update(JSON.stringify(parts))
		.digest("hex")
		.slice(0, 48);
	return `${scope}:${digest}`;
}

function openRouterModel(provider: AIProvider, modelId: AIModelId) {
	return provider === "openrouter"
		? getAIModel(modelId).openRouter
		: undefined;
}

/**
 * The explicit cache breakpoint to place after the largest stable part of a
 * prompt. Only models that need one (Anthropic) have it; the rest cache
 * automatically.
 */
export function openRouterCacheBreakpoint(
	provider: AIProvider,
	modelId: AIModelId,
) {
	const promptCache = openRouterModel(provider, modelId)?.promptCache;
	if (promptCache?.mode !== "anthropic-explicit") return undefined;

	return { openrouter: { cacheControl: promptCache.breakpoint } };
}

/**
 * Per-request gateway settings: which hosts of this model to prefer, whether
 * to mark a cache breakpoint, and which session the request belongs to.
 * Empty for every provider a library reaches directly.
 */
export function openRouterModelSettings(
	provider: AIProvider,
	modelId: AIModelId,
	options: { sessionId?: string } = {},
) {
	const model = openRouterModel(provider, modelId);
	if (!model) return {};

	const breakpoint =
		model.promptCache.mode === "anthropic-explicit"
			? model.promptCache.breakpoint
			: undefined;

	return {
		usage: { include: true as const },
		// Preferred OpenRouter hosts for this model (Bedrock for Luna, AI
		// Studio for Gemini). Fallbacks stay on, so a host outage degrades to
		// another host of the same model, never to a different model.
		...(model.providerOrder.length > 0
			? {
					provider: {
						order: [...model.providerOrder],
						allow_fallbacks: true,
					},
				}
			: {}),
		...(breakpoint ? { cache_control: breakpoint } : {}),
		...(options.sessionId
			? { extraBody: { session_id: options.sessionId } }
			: {}),
	};
}

export function openRouterResponseCacheHeaders(
	ttlSeconds: number,
	options: { refresh?: boolean } = {},
) {
	return {
		"X-OpenRouter-Cache": "true",
		"X-OpenRouter-Cache-TTL": String(ttlSeconds),
		...(options.refresh ? { "X-OpenRouter-Cache-Clear": "true" } : {}),
	};
}
