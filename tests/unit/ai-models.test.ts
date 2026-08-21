import { describe, expect, it } from "vitest";

import { PLATFORM_AI_MODEL_CATALOG } from "@/config/library-config/catalogs";
import {
	AI_MODELS,
	CONTRACT_STARTER_QUESTIONS_MODEL_ID,
	defaultAIModelId,
	getAIModel,
	isAIModelId,
	isSelectableAIModelId,
	maximumReasoningEffort,
	selectableAIModels,
	starterQuestionsModelId,
	type ConfiguredAIProvider,
} from "@/lib/ai/models";

const openRouterLibrary: ConfiguredAIProvider[] = [
	{
		provider: "openrouter",
		enabled: true,
		defaultModel: "openai/gpt-5.6-luna",
		largeModel: "x-ai/grok-4.6",
		smallModel: "google/gemini-3.7-flash",
	},
	{
		provider: "openai",
		enabled: false,
		defaultModel: "gpt-5.4",
	},
];

const directProviderLibrary: ConfiguredAIProvider[] = [
	{
		provider: "google",
		enabled: true,
		defaultModel: "gemini-2.5-pro",
		smallModel: "gemini-2.5-flash",
	},
];

describe("AI model registry", () => {
	it("describes every model the manifest catalog can select", () => {
		const catalogModels = Object.values(PLATFORM_AI_MODEL_CATALOG)
			.flatMap((provider) => [
				...provider.active,
				...provider.large,
				...provider.small,
			]);

		for (const modelId of catalogModels) {
			expect(isAIModelId(modelId)).toBe(true);
			expect(getAIModel(modelId).name.length).toBeGreaterThan(0);
		}

		expect(Object.keys(AI_MODELS)).toHaveLength(
			new Set(catalogModels).size,
		);
	});

	it("keeps the two Claude models valid but never selectable", () => {
		for (const modelId of [
			"anthropic/claude-sonnet-5",
			"anthropic/claude-opus-5",
		] as const) {
			expect(isAIModelId(modelId)).toBe(true);
			expect(isSelectableAIModelId(modelId)).toBe(false);
			expect(getAIModel(modelId).hidden).toBe(true);
		}
	});

	it("carries the contract's verified reasoning effort per model", () => {
		expect(maximumReasoningEffort("openai/gpt-5.6-luna")).toBe("max");
		expect(maximumReasoningEffort("x-ai/grok-4.6")).toBe("xhigh");
		expect(maximumReasoningEffort("google/gemini-3.7-flash")).toBe("high");
		expect(maximumReasoningEffort("anthropic/claude-opus-5")).toBe("max");
	});

	it("leaves reasoning effort unset for models nobody verified", () => {
		expect(maximumReasoningEffort("gpt-5.4")).toBeUndefined();
		expect(maximumReasoningEffort("mistral-large-latest")).toBeUndefined();
	});
});

describe("models a library can offer", () => {
	it("lists the configured slots of enabled providers only", () => {
		expect(selectableAIModels(openRouterLibrary)).toEqual([
			{
				id: "openai/gpt-5.6-luna",
				provider: "openrouter",
				name: "GPT-5.6 Luna",
				company: "OpenAI",
			},
			{
				id: "x-ai/grok-4.6",
				provider: "openrouter",
				name: "Grok 4.6",
				company: "xAI",
			},
			{
				id: "google/gemini-3.7-flash",
				provider: "openrouter",
				name: "Gemini 3.7 Flash",
				company: "Google",
			},
		]);
	});

	it("drops repeated slots and hidden models", () => {
		const models = selectableAIModels([
			{
				provider: "openrouter",
				enabled: true,
				defaultModel: "openai/gpt-5.6-luna",
				largeModel: "openai/gpt-5.6-luna",
				smallModel: "anthropic/claude-sonnet-5",
			},
		]);

		expect(models.map(({ id }) => id)).toEqual([
			"openai/gpt-5.6-luna",
		]);
	});

	it("has nothing to offer when no provider is enabled", () => {
		expect(
			selectableAIModels([
				{ provider: "openai", enabled: false, defaultModel: "gpt-5.4" },
			]),
		).toEqual([]);
		expect(
			defaultAIModelId([
				{ provider: "openai", enabled: false, defaultModel: "gpt-5.4" },
			]),
		).toBeUndefined();
	});

	it("defaults to the first enabled provider's default model", () => {
		expect(defaultAIModelId(openRouterLibrary)).toBe(
			"openai/gpt-5.6-luna",
		);
		expect(defaultAIModelId(directProviderLibrary)).toBe(
			"gemini-2.5-pro",
		);
	});

	it("generates starter questions with the contract model when the library has it", () => {
		expect(starterQuestionsModelId(openRouterLibrary)).toBe(
			CONTRACT_STARTER_QUESTIONS_MODEL_ID,
		);
	});

	it("falls back to the small model when the contract model is unavailable", () => {
		expect(starterQuestionsModelId(directProviderLibrary)).toBe(
			"gemini-2.5-flash",
		);
		expect(
			starterQuestionsModelId([
				{
					provider: "mistral",
					enabled: true,
					defaultModel: "mistral-large-latest",
				},
			]),
		).toBe("mistral-large-latest");
	});
});
