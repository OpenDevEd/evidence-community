import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	convertToModelMessages: vi.fn(async (messages) => messages),
	generateObject: vi.fn(),
	provider: vi.fn(),
	streamText: vi.fn(),
	trackAIUsage: vi.fn(),
	validateMessages: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/config/library-config/features", () => ({
	isLibraryFeatureEnabled: (features: Record<string, boolean>, feature: string) =>
		features[feature] === true,
}));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: vi.fn(async () => ({
		ai: { providers: {} },
		analytics: {},
		features: { ai: true, aiSearch: true, deepResearch: true },
		revision: "test-revision",
		search: { embedder: { source: "openAi" } },
		updatedAt: "2026-08-21T00:00:00.000Z",
	})),
}));
vi.mock("@/i18n/server", () => ({
	getRuntimeRequestLocale: vi.fn(async () => "en-GB"),
}));
vi.mock("@/lib/ai-provider", () => ({
	AIProviderUnavailableError: class AIProviderUnavailableError extends Error {},
	getAIProviderForConfig: mocks.provider,
}));
vi.mock("@/lib/ai/telemetry", () => ({ trackAIUsage: mocks.trackAIUsage }));
vi.mock("@/lib/ai-prompts", () => ({
	getAISystemPrompt: vi.fn(() => "System prompt"),
}));
vi.mock("@/lib/utils", () => ({ isAIAllowed: vi.fn(() => true) }));
vi.mock("@/app/api/cache", () => ({
	getCachedItem: vi.fn(async () => ({
		item: {
			key: "ITEM0001",
			title: "Teaching by radio",
			attachmentsData: [
				{ key: "PDF00001", title: "First paper" },
				{ key: "PDF00002", title: "Second paper" },
			],
			fullTextPDFs: [
				{ key: "PDF00001", fullTextPDF: [{ text: "First", page: 1 }] },
				{ key: "PDF00002", fullTextPDF: [{ text: "Second", page: 1 }] },
			],
		},
	})),
}));
vi.mock("ai", () => ({
	convertToModelMessages: mocks.convertToModelMessages,
	generateObject: mocks.generateObject,
	safeValidateUIMessages: mocks.validateMessages,
	streamText: mocks.streamText,
}));

import { POST as chat } from "@/app/api/ai/chat/route";
import { POST as questions } from "@/app/api/ai/questions/route";
import { POST as publication } from "@/app/api/ai/route";

function post(path: string, body: Record<string, unknown>) {
	return new Request(`https://library.example.org${path}`, {
		body: JSON.stringify(body),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
}

describe("AI routes", () => {
	beforeEach(() => {
		mocks.provider.mockResolvedValue({
			defaultModel: { id: "default-model" },
			defaultModelId: "provider/default",
			largeModel: { id: "large-model" },
			largeModelId: "provider/large",
		});
		mocks.streamText.mockReturnValue({
			toTextStreamResponse: () => new Response("summary"),
			toUIMessageStreamResponse: () => new Response("chat"),
		});
		mocks.validateMessages.mockResolvedValue({
			success: true,
			data: [{ id: "message-1", role: "user", parts: [] }],
		});
		mocks.generateObject.mockResolvedValue({
			object: { questions: ["One?", "Two?", "Three?", "Four?", "Five?"] },
			providerMetadata: {},
			usage: { totalTokens: 12 },
		});
	});

	it("streams a publication summary from mocked provider output", async () => {
		const response = await publication(
			post("/api/ai?prompt=summarize", {
				prompt: "ITEM0001",
				provider: "openrouter",
			}),
		);

		expect(await response.text()).toBe("summary");
		const call = mocks.streamText.mock.calls[0]?.[0];
		const item = JSON.parse(String(call.prompt));
		expect(item.attachmentsData[1].fullTextPDF).toEqual([
			{ text: "Second", page: 1 },
		]);
	});

	it("generates five questions with the matching PDF titles", async () => {
		const response = await questions(
			post("/api/ai/questions", {
				prompt: "ITEM0001",
				provider: "openrouter",
			}),
		);

		expect(await response.json()).toEqual([
			"One?",
			"Two?",
			"Three?",
			"Four?",
			"Five?",
		]);
		const documents = JSON.parse(
			String(mocks.generateObject.mock.calls[0]?.[0].prompt),
		);
		expect(documents.map((document: { title: string }) => document.title)).toEqual(
			["First paper", "Second paper"],
		);
	});

	it("streams chat through the selected mocked model", async () => {
		const response = await chat(
			post("/api/ai/chat", {
				id: "chat-1",
				messages: [{ id: "message-1", role: "user", parts: [] }],
				mode: "full",
				provider: "openrouter",
				trigger: "submit-message",
			}),
		);

		expect(await response.text()).toBe("chat");
		expect(mocks.streamText.mock.calls[0]?.[0].model).toEqual({
			id: "large-model",
		});
		expect(mocks.convertToModelMessages).toHaveBeenCalledOnce();
	});
});
