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

type AIModelConfig = Pick<
	LibraryServerConfig,
	"ai" | "revision" | "updatedAt"
>;

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
 * manifest has it in one of its slots, so a request can never reach a model
 * the library did not configure.
 */
export async function resolveAIModel(
	config: AIModelConfig,
	requestedModelId: unknown,
): Promise<ResolvedAIModel> {
	if (!isAIModelId(requestedModelId)) throw unavailable(requestedModelId);

	for (const provider of config.ai.providers) {
		if (!provider.enabled) continue;

		const models = await getAIProviderForConfig(
			config,
			provider.provider,
		);
		const slots = [
			[models.defaultModelId, models.defaultModel],
			[models.largeModelId, models.largeModel],
			[models.smallModelId, models.smallModel],
		] as const;
		const match = slots.find(([modelId]) => modelId === requestedModelId);

		if (match) {
			return {
				provider: provider.provider,
				modelId: requestedModelId,
				model: match[1],
				createModel: models.createModel,
			};
		}
	}

	throw unavailable(requestedModelId);
}

export function resolveStarterQuestionsModel(config: AIModelConfig) {
	return resolveAIModel(
		config,
		starterQuestionsModelId(config.ai.providers),
	);
}
