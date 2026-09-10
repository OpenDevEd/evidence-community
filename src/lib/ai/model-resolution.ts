import "server-only";

import type { LanguageModel } from "ai";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { LanguageModelFactory } from "@/lib/ai-provider-factory";
import { getAIProviderForConfig } from "@/lib/ai-provider";
import { AIError } from "./errors";
import {
	isAIModelId,
	starterQuestionsModelId,
	type AIModelId,
	type AIProvider,
} from "./models";

type AIModelConfig = Pick<LibraryServerConfig, "ai" | "revision" | "updatedAt">;

export type ResolvedAIModel = {
	provider: AIProvider;
	modelId: AIModelId;
	model: LanguageModel;
	/** Rebuilds this model with per-request gateway settings. */
	createModel: LanguageModelFactory;
};

function unavailable(modelId: unknown): AIError {
	return new AIError(
		"MODEL_UNAVAILABLE",
		`This library does not offer the model ${String(modelId)}.`,
		400,
	);
}

/**
 * Turns the model the request asked for into a usable model, or refuses.
 * A model counts as available only when an enabled provider in the library
 * manifest has it in its ordered model list, so a request can never reach a model
 * the library did not configure.
 */
export async function resolveAIModel(
	config: AIModelConfig,
	requestedModelId: unknown,
): Promise<ResolvedAIModel> {
	if (!isAIModelId(requestedModelId)) {
		throw unavailable(requestedModelId);
	}

	for (const provider of config.ai.providers) {
		if (!provider.enabled) continue;
		if (!provider.models.includes(requestedModelId)) continue;

		const models = await getAIProviderForConfig(config, provider.provider);
		return {
			provider: provider.provider,
			modelId: requestedModelId,
			model: models.createModel(requestedModelId),
			createModel: models.createModel,
		};
	}

	throw unavailable(requestedModelId);
}

export async function resolveStarterQuestionsModel(config: AIModelConfig) {
	const modelId = starterQuestionsModelId(config.ai.providers);
	if (!modelId) throw unavailable(modelId);

	const openRouter = config.ai.providers.find(
		(provider) => provider.enabled && provider.provider === "openrouter",
	);
	if (!openRouter) return resolveAIModel(config, modelId);

	const models = await getAIProviderForConfig(config, "openrouter");
	return {
		provider: "openrouter" as const,
		modelId,
		model: models.createModel(modelId),
		createModel: models.createModel,
	};
}
