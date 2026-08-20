import "server-only";

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { AIModelId } from "./models";
import { AIError } from "./errors";
import { createOpenRouterModelSettings } from "./openrouter-cache";

export function isOpenRouterConfigured() {
	return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function getOpenRouterModel(
	modelId: AIModelId,
	options: { sessionId?: string } = {},
) {
	const apiKey = process.env.OPENROUTER_API_KEY?.trim();
	if (!apiKey) {
		throw new AIError(
			"AI_DISABLED",
			"AI features are not configured.",
			503,
		);
	}

	const openrouter = createOpenRouter({
		apiKey,
		compatibility: "strict",
	});
	return openrouter(modelId, createOpenRouterModelSettings(modelId, options));
}
