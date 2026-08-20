export const AI_MODELS = [
	{
		id: "openai/gpt-5.6-luna",
		name: "GPT-5.6 Luna",
		company: "OpenAI",
		hidden: false,
		maximumReasoningEffort: "max",
		openRouter: {
			promptCache: {
				mode: "automatic",
				topLevel: null,
				explicit: null,
			},
		},
	},
	{
		id: "google/gemini-3.7-flash",
		name: "Gemini 3.7 Flash",
		company: "Google",
		hidden: false,
		maximumReasoningEffort: "high",
		openRouter: {
			promptCache: {
				mode: "automatic",
				topLevel: null,
				explicit: null,
			},
		},
	},
	{
		id: "x-ai/grok-4.6",
		name: "Grok 4.6",
		company: "xAI",
		hidden: false,
		maximumReasoningEffort: "xhigh",
		openRouter: {
			promptCache: {
				mode: "automatic",
				topLevel: null,
				explicit: null,
			},
		},
	},
	{
		id: "anthropic/claude-sonnet-5",
		name: "Claude Sonnet 5",
		company: "Anthropic",
		hidden: true,
		maximumReasoningEffort: "max",
		openRouter: {
			promptCache: {
				mode: "anthropic-explicit",
				topLevel: { type: "ephemeral", ttl: "1h" },
				explicit: { type: "ephemeral", ttl: "1h" },
			},
		},
	},
	{
		id: "anthropic/claude-opus-5",
		name: "Claude Opus 5",
		company: "Anthropic",
		hidden: true,
		maximumReasoningEffort: "max",
		openRouter: {
			promptCache: {
				mode: "anthropic-explicit",
				topLevel: { type: "ephemeral", ttl: "1h" },
				explicit: { type: "ephemeral", ttl: "1h" },
			},
		},
	},
] as const;

export type AIModelId = (typeof AI_MODELS)[number]["id"];

export const DEFAULT_AI_MODEL_ID: AIModelId = "openai/gpt-5.6-luna";
export const STARTER_QUESTIONS_MODEL_ID: AIModelId = "openai/gpt-5.6-luna";

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

export function maximumReasoningEffort(modelId: AIModelId) {
	return getAIModel(modelId).maximumReasoningEffort;
}
