import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import {
	createOpenRouter,
	type OpenRouterChatSettings,
} from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { RevisionAwareResourceFactory } from "./revision-aware-resource";

export type AIProviderId =
	LibraryServerConfig["ai"]["providers"][number]["provider"];
export type AIProviderConfiguration = LibraryServerConfig["ai"]["providers"];

/**
 * Per-request gateway settings. Only the OpenRouter path uses them; every
 * direct provider ignores them.
 */
export type ProviderModelSettings = OpenRouterChatSettings;

export type LanguageModelFactory = (
	modelId: string,
	settings?: ProviderModelSettings,
) => LanguageModel;
export type AIProviderClientFactory = (apiKey: string) => LanguageModelFactory;
export type AIProviderClientFactories = Record<
	AIProviderId,
	AIProviderClientFactory
>;

type ResolvedAIModels = {
	provider: AIProviderId;
	/** Builds a model of this provider, with optional per-request settings. */
	createModel: LanguageModelFactory;
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
		return (modelId, settings) => provider.languageModel(modelId, settings);
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
				models: configuredModels,
				provider,
			} = providerConfiguration;
			if (!apiKey || configuredModels.length === 0) {
				throw new Error(
					`Enabled AI provider is incomplete: ${provider}`,
				);
			}

			const createModel = factories[provider](apiKey);
			models.set(provider, {
				provider,
				createModel,
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
