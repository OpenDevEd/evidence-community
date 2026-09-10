import { describe, expect, it } from "vitest";

import {
	CONTRACT_STARTER_QUESTIONS_MODEL_ID,
	defaultAIModelId,
	selectableAIModels,
	starterQuestionsModelId,
	type ConfiguredAIProvider,
} from "@/lib/ai/models";

const openRouterLibrary: ConfiguredAIProvider[] = [
	{
		provider: "openrouter",
		enabled: true,
		models: [
			"x-ai/grok-4.6",
			"google/gemini-3.7-flash",
			"openai/gpt-5.6-luna",
		],
		defaultModel: "google/gemini-3.7-flash",
		modelMetadata: {
			"x-ai/grok-4.6": { name: "Grok 4.6", company: "xAI" },
			"google/gemini-3.7-flash": {
				name: "Gemini 3.7 Flash",
				company: "Google",
			},
			"openai/gpt-5.6-luna": { name: "GPT-5.6 Luna", company: "OpenAI" },
		},
	},
	{
		provider: "openai",
		enabled: false,
		models: ["gpt-5.4"],
		defaultModel: "gpt-5.4",
	},
];

const directProviderLibrary: ConfiguredAIProvider[] = [
	{
		provider: "google",
		enabled: true,
		models: ["gemini-2.5-pro", "gemini-2.5-flash"],
		defaultModel: "gemini-2.5-pro",
	},
];

describe("models a library can offer", () => {
	it("keeps the configured order for enabled providers only", () => {
		expect(selectableAIModels(openRouterLibrary)).toEqual([
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
			{
				id: "openai/gpt-5.6-luna",
				provider: "openrouter",
				name: "GPT-5.6 Luna",
				company: "OpenAI",
			},
		]);
	});

	it("shows each configured model once", () => {
		const models = selectableAIModels([
			{
				provider: "openrouter",
				enabled: true,
				models: [
					"openai/gpt-5.6-luna",
					"openai/gpt-5.6-luna",
					"anthropic/claude-sonnet-5",
				],
				defaultModel: "openai/gpt-5.6-luna",
			},
		]);

		expect(models.map(({ id }) => id)).toEqual([
			"openai/gpt-5.6-luna",
			"anthropic/claude-sonnet-5",
		]);
	});

	it("has nothing to offer when no provider is enabled", () => {
		expect(
			selectableAIModels([
				{
					provider: "openai",
					enabled: false,
					models: ["gpt-5.4"],
					defaultModel: "gpt-5.4",
				},
			]),
		).toEqual([]);
		expect(
			defaultAIModelId([
				{
					provider: "openai",
					enabled: false,
					models: ["gpt-5.4"],
					defaultModel: "gpt-5.4",
				},
			]),
		).toBeUndefined();
	});

	it("defaults to the first enabled provider's default model", () => {
		expect(defaultAIModelId(openRouterLibrary)).toBe(
			"google/gemini-3.7-flash",
		);
		expect(defaultAIModelId(directProviderLibrary)).toBe("gemini-2.5-pro");
	});

	it("generates OpenRouter starter questions with Luna outside the picker list", () => {
		const withoutLuna = [
			{
				provider: "openrouter" as const,
				enabled: true,
				models: ["x-ai/grok-4.6"],
				defaultModel: "x-ai/grok-4.6",
			},
		];
		expect(starterQuestionsModelId(openRouterLibrary)).toBe(
			CONTRACT_STARTER_QUESTIONS_MODEL_ID,
		);
		expect(starterQuestionsModelId(withoutLuna)).toBe(
			CONTRACT_STARTER_QUESTIONS_MODEL_ID,
		);
	});

	it("falls back to the default model for a direct provider", () => {
		expect(starterQuestionsModelId(directProviderLibrary)).toBe(
			"gemini-2.5-pro",
		);
		expect(
			starterQuestionsModelId([
				{
					provider: "mistral",
					enabled: true,
					models: ["mistral-large-latest"],
					defaultModel: "mistral-large-latest",
				},
			]),
		).toBe("mistral-large-latest");
	});
});
