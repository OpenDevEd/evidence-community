import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
	AIProviderService,
	AIProviderUnavailableError,
	RevisionAwareAIProviderFactory,
	type AIProviderClientFactories,
	type AIProviderId,
} from "@/lib/ai-provider-factory";
import { RevisionResourceConflictError } from "@/lib/revision-aware-resource";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { cloneLibraryConfig } from "../fixtures/library-config";

function config() {
	return libraryConfigSchema.parse(cloneLibraryConfig());
}

function fakeModel(provider: AIProviderId, modelId: string) {
	return { modelId, provider } as unknown as LanguageModel;
}

function providerFactories() {
	const calls: Array<{ apiKey: string; provider: AIProviderId }> = [];
	const create = (provider: AIProviderId) => (apiKey: string) => {
		calls.push({ apiKey, provider });
		return (modelId: string) => fakeModel(provider, modelId);
	};
	const factories = {
		anthropic: vi.fn(create("anthropic")),
		deepseek: vi.fn(create("deepseek")),
		google: vi.fn(create("google")),
		mistral: vi.fn(create("mistral")),
		openai: vi.fn(create("openai")),
		openrouter: vi.fn(create("openrouter")),
	} satisfies AIProviderClientFactories;

	return { calls, factories };
}

describe("runtime AI provider service", () => {
	it("instantiates only enabled providers with their configured key", () => {
		const libraryConfig = config();
		libraryConfig.ai.providers.push({
			provider: "openai",
			enabled: false,
			apiKey: "disabled-openai-key",
			defaultModel: "gpt-5.4-mini",
			largeModel: "gpt-5.4",
			smallModel: "gpt-5.4-mini",
		});
		const { calls, factories } = providerFactories();

		const service = new AIProviderService(
			libraryConfig.ai.providers,
			factories,
		);
		const google = service.resolve("google");

		expect(calls).toEqual([
			{ apiKey: "google-api-key", provider: "google" },
		]);
		expect(google).toMatchObject({
			provider: "google",
			defaultModelId: "gemini-2.5-flash",
			largeModelId: "gemini-2.5-pro",
			smallModelId: "gemini-2.5-flash",
		});
		expect(() => service.resolve("openai")).toThrow(
			AIProviderUnavailableError,
		);
	});

	it("keeps every selected model inside the requested provider", () => {
		const libraryConfig = config();
		libraryConfig.ai.providers.push({
			provider: "openai",
			enabled: true,
			apiKey: "openai-api-key",
			defaultModel: "gpt-5.4-mini",
			largeModel: "gpt-5.4",
			smallModel: "gpt-5.4-mini",
		});
		const { factories } = providerFactories();
		const service = new AIProviderService(
			libraryConfig.ai.providers,
			factories,
		);

		const google = service.resolve("google");
		const openai = service.resolve("openai");

		expect(google.defaultModel).toMatchObject({
			provider: "google",
			modelId: "gemini-2.5-flash",
		});
		expect(openai.defaultModel).toMatchObject({
			provider: "openai",
			modelId: "gpt-5.4-mini",
		});
	});

	it("rejects changed provider credentials under one revision", async () => {
		const libraryConfig = config();
		const { factories } = providerFactories();
		const factory = new RevisionAwareAIProviderFactory(factories);
		await factory.get({
			configuration: libraryConfig.ai.providers,
			revision: "ai-one",
			updatedAt: "2026-07-28T08:00:00.000Z",
		});

		const changedProviders = structuredClone(
			libraryConfig.ai.providers,
		);
		changedProviders[0].apiKey = "changed-google-key";

		await expect(
			factory.get({
				configuration: changedProviders,
				revision: "ai-one",
				updatedAt: "2026-07-28T08:00:00.000Z",
			}),
		).rejects.toBeInstanceOf(RevisionResourceConflictError);
	});
});
