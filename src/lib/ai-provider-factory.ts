import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { RevisionAwareResourceFactory } from "./revision-aware-resource";

export type AIProviderId =
	LibraryServerConfig["ai"]["providers"][number]["provider"];
export type AIProviderConfiguration =
	LibraryServerConfig["ai"]["providers"];

type LanguageModelFactory = (modelId: string) => LanguageModel;
export type AIProviderClientFactory = (
	apiKey: string,
) => LanguageModelFactory;
export type AIProviderClientFactories = Record<
	AIProviderId,
	AIProviderClientFactory
>;

export type ResolvedAIModels = {
	provider: AIProviderId;
	defaultModel: LanguageModel;
	defaultModelId: string;
	largeModel: LanguageModel;
	largeModelId: string;
	smallModel: LanguageModel;
	smallModelId: string;
};

const providerClientFactories: AIProviderClientFactories = {
	anthropic(apiKey) {
		const provider = createAnthropic({ apiKey });
		return (modelId) => provider(modelId);
	},
	deepseek(apiKey) {
		const provider = createDeepSeek({ apiKey });
		return (modelId) => provider(modelId);
	},
	google(apiKey) {
		const provider = createGoogleGenerativeAI({ apiKey });
		return (modelId) => provider(modelId);
	},
	mistral(apiKey) {
		const provider = createMistral({ apiKey });
		return (modelId) => provider(modelId);
	},
	openai(apiKey) {
		const provider = createOpenAI({ apiKey });
		return (modelId) => provider(modelId);
	},
	openrouter(apiKey) {
		const provider = createOpenRouter({ apiKey, compatibility: "strict" });
		return (modelId) => provider.languageModel(modelId);
	},
};

export class AIProviderUnavailableError extends Error {
	constructor(provider: string) {
		super(`AI provider is unavailable: ${provider}`);
		this.name = "AIProviderUnavailableError";
	}
}

export class AIProviderService {
	readonly #models: ReadonlyMap<AIProviderId, ResolvedAIModels>;

	constructor(
		configuration: AIProviderConfiguration,
		factories: AIProviderClientFactories = providerClientFactories,
	) {
		const models = new Map<AIProviderId, ResolvedAIModels>();

		for (const providerConfiguration of configuration) {
			if (!providerConfiguration.enabled) continue;

			const {
				apiKey,
				defaultModel,
				largeModel,
				provider,
				smallModel,
			} = providerConfiguration;
			if (!apiKey || !defaultModel) {
				throw new Error(
					`Enabled AI provider is incomplete: ${provider}`,
				);
			}

			const createModel = factories[provider](apiKey);
			const resolvedLargeModel = largeModel ?? defaultModel;
			const resolvedSmallModel = smallModel ?? defaultModel;
			models.set(provider, {
				provider,
				defaultModel: createModel(defaultModel),
				defaultModelId: defaultModel,
				largeModel: createModel(resolvedLargeModel),
				largeModelId: resolvedLargeModel,
				smallModel: createModel(resolvedSmallModel),
				smallModelId: resolvedSmallModel,
			});
		}

		this.#models = models;
	}

	resolve(provider: AIProviderId) {
		const models = this.#models.get(provider);
		if (!models) {
			throw new AIProviderUnavailableError(provider);
		}
		return models;
	}
}

function configurationsEqual(
	left: AIProviderConfiguration,
	right: AIProviderConfiguration,
) {
	return JSON.stringify(left) === JSON.stringify(right);
}

export class RevisionAwareAIProviderFactory {
	readonly #factory: RevisionAwareResourceFactory<
		AIProviderConfiguration,
		AIProviderService
	>;

	constructor(
		factories: AIProviderClientFactories = providerClientFactories,
	) {
		this.#factory = new RevisionAwareResourceFactory(
			"AI providers",
			(configuration) => ({
				value: new AIProviderService(configuration, factories),
			}),
			{ configurationEquals: configurationsEqual },
		);
	}

	get({
		configuration,
		revision,
		updatedAt,
	}: {
		configuration: AIProviderConfiguration;
		revision: string;
		updatedAt: string;
	}) {
		return this.#factory.get({
			configuration,
			revision,
			updatedAt,
		});
	}
}
