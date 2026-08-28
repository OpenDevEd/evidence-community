import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
	libraryConfigSchema,
	type LibraryConfigInput,
} from "@/config/library-config/schema";
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

	it("refuses a real model this library never configured", async () => {
		await expect(resolveAIModel(config(), "gpt-5.4")).rejects.toThrow(
			AIError,
		);
		await expect(
			resolveAIModel(config(), "gpt-5.4"),
		).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE", status: 400 });
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
				defaultModel: "gemini-2.5-flash",
				largeModel: "gemini-2.5-pro",
			},
			{
				provider: "openai",
				enabled: false,
				apiKey: "openai-api-key",
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
					defaultModel: "openai/gpt-5.6-luna",
					largeModel: "x-ai/grok-4.6",
					smallModel: "google/gemini-3.7-flash",
				},
			]),
		);

		expect(resolved.provider).toBe("openrouter");
		expect(resolved.modelId).toBe("openai/gpt-5.6-luna");
	});
});
