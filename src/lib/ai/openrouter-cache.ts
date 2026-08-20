import { createHash } from "node:crypto";
import { getAIModel, type AIModelId } from "./models";

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
	const topLevelCacheControl =
		getAIModel(modelId).openRouter.promptCache.topLevel;

	return {
		usage: { include: true as const },
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
