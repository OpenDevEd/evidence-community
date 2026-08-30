import { PLATFORM_AI_MODEL_CATALOG } from "@/config/library-config/catalogs";

type ModelCatalog = typeof PLATFORM_AI_MODEL_CATALOG;

export type AIProvider = keyof ModelCatalog;

/**
 * Reasoning levels the AI modernization contract verified per model. Deep
 * Research raises a model to its own maximum for publication selection and
 * synthesis; every other step keeps the provider default.
 */
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

type PromptCache =
	| { mode: "automatic" }
	| {
			mode: "anthropic-explicit";
			breakpoint: { type: "ephemeral"; ttl: "1h" };
	  };

export type AIModel = {
	name: string;
	company: string;
	/** Reserved for internal server use and never accepted from public configuration. */
	hidden: boolean;
	/** Unset when no one has verified how far this model's reasoning goes. */
	maximumReasoningEffort?: ReasoningEffort;
	/**
	 * OpenRouter endpoint tags to try first (same model, different host) and
	 * the caching the gateway should apply. Only meaningful when the library
	 * reaches this model through its OpenRouter key.
	 */
	openRouter?: {
		providerOrder: readonly string[];
		promptCache: PromptCache;
	};
};

const automaticCache = { mode: "automatic" } as const;
const anthropicHourCache = {
	mode: "anthropic-explicit",
	breakpoint: { type: "ephemeral", ttl: "1h" },
} as const;

const AI_MODEL_REGISTRY = {
	"openai/gpt-5.6-luna": {
		name: "GPT-5.6 Luna",
		company: "OpenAI",
		hidden: false,
		maximumReasoningEffort: "max",
		openRouter: {
			// Luna needs the regional tag: the bare "amazon-bedrock" slug is
			// not matched against this model's Bedrock endpoint.
			providerOrder: ["amazon-bedrock/us-east-1"],
			promptCache: automaticCache,
		},
	},
	"google/gemini-3.7-flash": {
		name: "Gemini 3.7 Flash",
		company: "Google",
		hidden: false,
		maximumReasoningEffort: "high",
		openRouter: {
			providerOrder: ["google-ai-studio"],
			promptCache: automaticCache,
		},
	},
	"x-ai/grok-4.6": {
		name: "Grok 4.6",
		company: "xAI",
		hidden: false,
		maximumReasoningEffort: "xhigh",
		openRouter: {
			providerOrder: [],
			promptCache: automaticCache,
		},
	},
	"anthropic/claude-sonnet-5": {
		name: "Claude Sonnet 5",
		company: "Anthropic",
		hidden: true,
		maximumReasoningEffort: "max",
		openRouter: {
			providerOrder: [],
			promptCache: anthropicHourCache,
		},
	},
	"anthropic/claude-opus-5": {
		name: "Claude Opus 5",
		company: "Anthropic",
		hidden: true,
		maximumReasoningEffort: "max",
		openRouter: {
			providerOrder: [],
			promptCache: anthropicHourCache,
		},
	},
	"gpt-5.4": { name: "GPT-5.4", company: "OpenAI", hidden: false },
	"gpt-5.4-mini": {
		name: "GPT-5.4 mini",
		company: "OpenAI",
		hidden: false,
	},
	"gemini-2.5-pro": {
		name: "Gemini 2.5 Pro",
		company: "Google",
		hidden: false,
	},
	"gemini-2.5-flash": {
		name: "Gemini 2.5 Flash",
		company: "Google",
		hidden: false,
	},
	"claude-sonnet-4-6": {
		name: "Claude Sonnet 4.6",
		company: "Anthropic",
		hidden: false,
	},
	"claude-haiku-4-5": {
		name: "Claude Haiku 4.5",
		company: "Anthropic",
		hidden: false,
	},
	"mistral-large-latest": {
		name: "Mistral Large",
		company: "Mistral",
		hidden: false,
	},
	"mistral-small-latest": {
		name: "Mistral Small",
		company: "Mistral",
		hidden: false,
	},
	"deepseek-v4-pro": {
		name: "DeepSeek V4 Pro",
		company: "DeepSeek",
		hidden: false,
	},
	"deepseek-v4-flash": {
		name: "DeepSeek V4 Flash",
		company: "DeepSeek",
		hidden: false,
	},
} as const satisfies Record<string, AIModel>;

export type AIModelId = keyof typeof AI_MODEL_REGISTRY;
export const AI_MODELS: Record<AIModelId, AIModel> = AI_MODEL_REGISTRY;

/** The fixed OpenRouter model reserved for generated starter questions. */
export const CONTRACT_STARTER_QUESTIONS_MODEL_ID: AIModelId =
	"openai/gpt-5.6-luna";

export function isAIModelId(value: unknown): value is AIModelId {
	return typeof value === "string" && Object.hasOwn(AI_MODELS, value);
}

export function isSelectableAIModelId(value: unknown): value is AIModelId {
	return isAIModelId(value) && !AI_MODELS[value].hidden;
}

export function getAIModel(modelId: AIModelId) {
	return AI_MODELS[modelId];
}

export function maximumReasoningEffort(modelId: AIModelId) {
	return AI_MODELS[modelId].maximumReasoningEffort;
}

/**
 * The provider shape shared by the server manifest and its public
 * projection: the public one simply has no API key.
 */
export type ConfiguredAIProvider = {
	provider: AIProvider;
	enabled: boolean;
	models: readonly string[];
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
			if (models.has(id) || AI_MODELS[id].hidden) continue;
			models.set(id, {
				id,
				provider: provider.provider,
				name: AI_MODELS[id].name,
				company: AI_MODELS[id].company,
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
				isSelectableAIModelId(model) &&
				selectable.some(({ id }) => id === model),
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
