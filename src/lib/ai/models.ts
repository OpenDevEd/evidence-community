import { PLATFORM_AI_PROVIDERS } from "@/config/library-config/catalogs";
import { modelIdSchema } from "@/config/library-config/primitives";

export type AIProvider = (typeof PLATFORM_AI_PROVIDERS)[number];
export type AIModelId = string;
export type AIModel = { name: string; company: string };

/** Fixed by the starter-question generation contract, not a selectable catalog. */
export const CONTRACT_STARTER_QUESTIONS_MODEL_ID = "openai/gpt-5.6-luna";

export function isAIModelId(value: unknown): value is AIModelId {
	const parsed = modelIdSchema.safeParse(value);
	return parsed.success && parsed.data === value;
}

const MODEL_COMPANIES: Record<string, string> = {
	openai: "OpenAI",
	google: "Google",
	anthropic: "Anthropic",
	"x-ai": "xAI",
	mistralai: "Mistral",
	mistral: "Mistral",
	deepseek: "DeepSeek",
	"z-ai": "Z.ai",
};

/** Catalog names are supplied by OpenScholar. Hand-written configurations can use the id. */
export function getAIModel(
	modelId: AIModelId,
	providers: readonly ConfiguredAIProvider[] = [],
): AIModel {
	for (const provider of providers) {
		const metadata = provider.modelMetadata;
		if (metadata && Object.hasOwn(metadata, modelId))
			return metadata[modelId];
	}
	const publisher = modelId.includes("/")
		? modelId.replace(/^~/u, "").split("/")[0]
		: providers.find((provider) => provider.models.includes(modelId))?.provider ?? "";
	return {
		name: modelId,
		company: Object.hasOwn(MODEL_COMPANIES, publisher)
			? MODEL_COMPANIES[publisher]
			: publisher,
	};
}

export type ConfiguredAIProvider = {
	provider: AIProvider;
	enabled: boolean;
	models: readonly string[];
	modelMetadata?: Readonly<Record<string, AIModel>>;
	defaultModel?: string;
};

export type SelectableAIModel = {
	id: AIModelId;
	provider: AIProvider;
	name: string;
	company: string;
};

function configuredModelIds(provider: ConfiguredAIProvider) {
	return provider.models.filter(isAIModelId);
}

function enabledProviders(providers: readonly ConfiguredAIProvider[]) {
	return providers.filter(({ enabled }) => enabled);
}

/**
 * Every model this library offers in its picker, in the configured order.
 */
export function selectableAIModels(
	providers: readonly ConfiguredAIProvider[],
): SelectableAIModel[] {
	const models = new Map<AIModelId, SelectableAIModel>();

	for (const provider of enabledProviders(providers)) {
		for (const id of configuredModelIds(provider)) {
			if (models.has(id)) continue;
			const model = getAIModel(id, [provider]);
			models.set(id, {
				id,
				provider: provider.provider,
				name: model.name,
				company: model.company,
			});
		}
	}

	return [...models.values()];
}

export function defaultAIModelId(
	providers: readonly ConfiguredAIProvider[],
): AIModelId | undefined {
	const selectable = selectableAIModels(providers);
	const configuredDefault = enabledProviders(providers)
		.map(({ defaultModel }) => defaultModel)
		.find(
			(model): model is AIModelId =>
				isAIModelId(model) && selectable.some(({ id }) => id === model),
		);

	return configuredDefault ?? selectable[0]?.id;
}

/**
 * OpenRouter starter questions always use the fixed contract model. Other
 * providers fall back to their configured default model.
 */
export function starterQuestionsModelId(
	providers: readonly ConfiguredAIProvider[],
): AIModelId | undefined {
	const enabled = enabledProviders(providers);
	if (enabled.some(({ provider }) => provider === "openrouter")) {
		return CONTRACT_STARTER_QUESTIONS_MODEL_ID;
	}

	const [first] = enabled;
	if (!first) return undefined;
	return isAIModelId(first.defaultModel) ? first.defaultModel : undefined;
}
