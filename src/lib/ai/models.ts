export const AI_MODELS = [
	{
		id: "anthropic/claude-haiku-5.5",
		name: "Claude Haiku 5.5",
		company: "Anthropic",
		hidden: false,
		reasoningEffort: "medium",
		// Deep Research steps that pick and read publications; verified on OpenRouter 2026-11-19.
		maximumReasoningEffort: "max",
		openRouter: {
			providerOrder: [],
			allowFallbacks: true,
			promptCache: {
				mode: "anthropic-explicit",
				topLevel: { type: "ephemeral", ttl: "1h" },
				explicit: { type: "ephemeral", ttl: "1h" },
			},
		},
	},
	{
		id: "openai/gpt-6-luna",
		name: "GPT-6 Luna",
		company: "OpenAI",
		hidden: false,
		reasoningEffort: "medium",
		// Deep Research steps that pick and read publications; verified on OpenRouter 2026-11-19.
		maximumReasoningEffort: "max",
		openRouter: {
			// OpenRouter endpoint tags to try first (same model, different
			// host); other providers remain as fallbacks. Luna needs the
			// regional tag — the bare "amazon-bedrock" slug is not matched
			// against this model's Bedrock endpoint.
			providerOrder: ["amazon-bedrock/us-east-1"],
			allowFallbacks: true,
			promptCache: {
				mode: "automatic",
				topLevel: null,
				explicit: null,
			},
		},
	},
	{
		id: "google/gemini-4-hydrogen",
		name: "Gemini 4 Hydrogen",
		company: "Google",
		hidden: false,
		reasoningEffort: "low",
		// Deep Research steps that pick and read publications; verified on OpenRouter 2026-11-19.
		maximumReasoningEffort: "max",
		openRouter: {
			providerOrder: ["google-ai-studio"],
			// Gemini's thought signatures are accepted only by the Google host that
			// produced them, and every later step and turn sends them back, so a
			// fallback to another host mid-conversation fails the request.
			allowFallbacks: false,
			promptCache: {
				mode: "automatic",
				topLevel: null,
				explicit: null,
			},
		},
	},
] as const;

export type AIModelId = (typeof AI_MODELS)[number]["id"];

export const DEFAULT_AI_MODEL_ID: AIModelId = "openai/gpt-6-luna";
export const STARTER_QUESTIONS_MODEL_ID: AIModelId = "openai/gpt-6-luna";

const AI_MODEL_IDS = new Set<string>(AI_MODELS.map((model) => model.id));
const SELECTABLE_AI_MODEL_IDS = new Set<string>(
	AI_MODELS.filter(({ hidden }) => !hidden).map(({ id }) => id),
);

export function isAIModelId(value: unknown): value is AIModelId {
	return typeof value === "string" && AI_MODEL_IDS.has(value);
}

export function isSelectableAIModelId(value: unknown): value is AIModelId {
	return typeof value === "string" && SELECTABLE_AI_MODEL_IDS.has(value);
}

export function getAIModel(modelId: AIModelId) {
	return AI_MODELS.find(({ id }) => id === modelId)!;
}

/** The reasoning effort every request to this model uses. */
export function reasoningEffort(modelId: AIModelId) {
	return getAIModel(modelId).reasoningEffort;
}

/** The effort Deep Research uses when it picks publications to read and writes after reading them. */
export function maximumReasoningEffort(modelId: AIModelId) {
	return getAIModel(modelId).maximumReasoningEffort;
}
