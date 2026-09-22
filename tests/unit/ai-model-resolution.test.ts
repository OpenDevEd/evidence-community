import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
	libraryConfigSchema,
	type LibraryConfigInput,
} from "@/config/library-config/schema";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { selectableAIModels } from "@/lib/ai/models";
import { chatRequestSchema } from "@/lib/ai/schemas";
import { AIError } from "@/lib/ai/errors";
import {
	resolveAIModel,
	resolveStarterQuestionsModel,
} from "@/lib/ai/model-resolution";
import { cloneLibraryConfig } from "../fixtures/library-config";

let revisionCounter = 0;

// The provider factory refuses to rebuild providers under a revision it has
// already seen, so every changed manifest in these tests gets its own.
type ConfiguredProviders = NonNullable<
	NonNullable<LibraryConfigInput["ai"]>["providers"]
>;

function config(providers?: ConfiguredProviders) {
	const draft = cloneLibraryConfig();
	if (providers) draft.ai = { ...draft.ai, providers };
	revisionCounter += 1;
	draft.revision = `resolution-${revisionCounter}`;
	draft.updatedAt = new Date(
		Date.UTC(2026, 7, 21, 12, revisionCounter),
	).toISOString();
	return libraryConfigSchema.parse(draft);
}

describe("choosing the model a request runs on", () => {
	it("resolves a model an enabled provider configured", async () => {
		const resolved = await resolveAIModel(config(), "gemini-2.5-pro");

		expect(resolved.provider).toBe("google");
		expect(resolved.modelId).toBe("gemini-2.5-pro");
		expect(resolved.model).toBeDefined();
	});

	it("runs a newly configured OpenRouter model through the picker and request boundary", async () => {
		const modelId = "deepseek/deepseek-v4.1-flash";
		const libraryConfig = config([
			{
				provider: "openrouter",
				enabled: true,
				apiKey: "openrouter-api-key",
				models: [modelId],
				modelMetadata: {
					[modelId]: {
						name: "DeepSeek V4.1 Flash",
						company: "DeepSeek",
					},
				},
				defaultModel: modelId,
			},
		]);
		expect(selectableAIModels(projectPublicLibraryConfig(libraryConfig).ai.providers)).toEqual([
			{
				id: modelId,
				provider: "openrouter",
				name: "DeepSeek V4.1 Flash",
				company: "DeepSeek",
			},
		]);
		const request = chatRequestSchema.parse({
			id: "new-model-chat",
			messages: [
				{
					role: "user",
					parts: [{ type: "text", text: "What was added?" }],
				},
			],
			trigger: "submit-message",
			modelId,
			mode: "quick",
		});
		const resolved = await resolveAIModel(libraryConfig, request.modelId);
		expect(resolved.model).toMatchObject({ modelId });
		await expect(
			resolveAIModel(libraryConfig, "openai/gpt-5.6-luna"),
		).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
	});

	it("refuses a real model this library never configured", async () => {
		await expect(resolveAIModel(config(), "gpt-5.4")).rejects.toThrow(
			AIError,
		);
		await expect(resolveAIModel(config(), "gpt-5.4")).rejects.toMatchObject(
			{ code: "MODEL_UNAVAILABLE", status: 400 },
		);
	});

	it("refuses a model identifier the client made up", async () => {
		await expect(
			resolveAIModel(config(), "openai/gpt-5.6-luna-turbo"),
		).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
	});

	it("ignores providers the library switched off", async () => {
		const libraryConfig = config([
			{
				provider: "google",
				enabled: true,
				apiKey: "google-api-key",
				models: ["gemini-2.5-flash", "gemini-2.5-pro"],
				defaultModel: "gemini-2.5-flash",
			},
			{
				provider: "openai",
				enabled: false,
				apiKey: "openai-api-key",
				models: ["gpt-5.4"],
				defaultModel: "gpt-5.4",
			},
		]);

		await expect(
			resolveAIModel(libraryConfig, "gpt-5.4"),
		).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
	});

	it("runs starter questions on the library's small model", async () => {
		const resolved = await resolveStarterQuestionsModel(config());

		expect(resolved.modelId).toBe("gemini-2.5-flash");
	});

	it("runs starter questions on the contract model when configured", async () => {
		const resolved = await resolveStarterQuestionsModel(
			config([
				{
					provider: "openrouter",
					enabled: true,
					apiKey: "openrouter-api-key",
					models: ["x-ai/grok-4.6", "google/gemini-3.7-flash"],
					defaultModel: "x-ai/grok-4.6",
				},
			]),
		);

		expect(resolved.provider).toBe("openrouter");
		expect(resolved.modelId).toBe("openai/gpt-6-luna");
	});
});
