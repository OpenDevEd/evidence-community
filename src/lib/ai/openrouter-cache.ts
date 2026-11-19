import { createHash } from "node:crypto";
import { getAIModel, reasoningEffort, type AIModelId } from "./models";

export const OPENROUTER_RESPONSE_CACHE_TTL = {
	chat: 300,
	publication: 3_600,
	questions: 86_400,
	screening: 3_600,
} as const;

export function createOpenRouterSessionId(scope: string, ...parts: string[]) {
	const digest = createHash("sha256")
		.update(JSON.stringify(parts))
		.digest("hex")
		.slice(0, 48);
	return `${scope}:${digest}`;
}

export function openRouterExplicitCacheProviderOptions(modelId: AIModelId) {
	const cacheControl = getAIModel(modelId).openRouter.promptCache.explicit;
	if (!cacheControl) return undefined;

	return {
		openrouter: {
			cacheControl,
		},
	};
}

export function createOpenRouterModelSettings(
	modelId: AIModelId,
	options: { sessionId?: string } = {},
) {
	const { promptCache, providerOrder, allowFallbacks } = getAIModel(modelId).openRouter;
	const topLevelCacheControl = promptCache.topLevel;

	return {
		usage: { include: true as const },
		reasoning: { effort: reasoningEffort(modelId) },
		// Preferred OpenRouter providers for this model (e.g. Bedrock for
		// Luna, AI Studio for Gemini). Fallbacks let a provider outage degrade
		// to another host of the same model, never to a different model, except
		// for models whose requests must stay on one host (Gemini).
		...(providerOrder.length > 0
			? {
					provider: {
						order: [...providerOrder],
						allow_fallbacks: allowFallbacks,
					},
				}
			: {}),
		...(topLevelCacheControl
			? { cache_control: topLevelCacheControl }
			: {}),
		...(options.sessionId
			? {
				extraBody: {
					session_id: options.sessionId,
				},
				}
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
