import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	convertToModelMessages: vi.fn(async (messages) => messages),
	createResearchAgent: vi.fn(),
	generateObject: vi.fn(),
	provider: vi.fn(),
	stream: vi.fn(),
	streamText: vi.fn(),
	trackAIUsage: vi.fn(),
	validateMessages: vi.fn(),
	libraryConfig: {
		ai: {
			providers: [
				{
					provider: "openrouter",
					enabled: true,
					apiKey: "openrouter-key",
					defaultModel: "openai/gpt-5.6-luna",
				},
			],
		},
		analytics: {},
		features: { ai: true, aiSearch: true, deepResearch: true },
		identity: { name: "Evidence Library" },
		revision: "test-revision",
		search: { embedder: { source: "openAi" } },
		updatedAt: "2026-08-21T00:00:00.000Z",
	} as Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/config/library-config/features", () => ({
	isLibraryFeatureEnabled: (
		features: Record<string, boolean>,
		feature: string,
	) => features[feature] === true,
}));
vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: vi.fn(async () => mocks.libraryConfig),
}));
vi.mock("@/i18n/server", () => ({
	getRuntimeRequestLocale: vi.fn(async () => "en-GB"),
}));
vi.mock("@/lib/ai-provider", () => ({
	AIProviderUnavailableError: class AIProviderUnavailableError extends Error {},
	getAIProviderForConfig: mocks.provider,
}));
vi.mock("@/lib/ai/agent", () => ({
	createResearchAgent: mocks.createResearchAgent,
}));
vi.mock("@/lib/ai/telemetry", () => ({ trackAIUsage: mocks.trackAIUsage }));
vi.mock("@/lib/ai-prompts", () => ({
	getAISystemPrompt: vi.fn(() => "System prompt"),
}));
vi.mock("@/app/api/cache", () => ({
	getCachedItem: vi.fn(async () => ({
		item: {
			key: "ITEM0001",
			title: "Teaching by radio",
			attachmentsData: [
				{
					key: "PDF00001",
					title: "First paper",
					PDFCoverPageImage: "cover-one.png",
				},
				{
					key: "PDF00002",
					title: "Second paper",
					PDFCoverPageImage: "cover-two.png",
				},
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

function chatRequest(overrides: Record<string, unknown> = {}) {
	return post("/api/ai/chat", {
		id: "chat-1",
		messages: [{ id: "message-1", role: "user", parts: [] }],
		mode: "quick",
		modelId: "openai/gpt-5.6-luna",
		trigger: "submit-message",
		...overrides,
	});
}

describe("AI routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.libraryConfig.features = {
			ai: true,
			aiSearch: true,
			deepResearch: true,
		};
		mocks.provider.mockResolvedValue({
			createModel: vi.fn((modelId: string) => ({ id: modelId })),
			defaultModel: { id: "default-model" },
			defaultModelId: "openai/gpt-5.6-luna",
			largeModel: { id: "large-model" },
			largeModelId: "x-ai/grok-4.6",
			smallModel: { id: "small-model" },
			smallModelId: "google/gemini-3.7-flash",
		});
		mocks.streamText.mockReturnValue({
			toTextStreamResponse: () => new Response("summary"),
			toUIMessageStreamResponse: () => new Response("chat"),
		});
		mocks.stream.mockResolvedValue({
			toUIMessageStreamResponse: () => new Response("agent answer"),
		});
		mocks.createResearchAgent.mockReturnValue({
			tools: { searchLibrary: {}, readPublications: {} },
			stream: mocks.stream,
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
		expect(
			documents.map((document: { title: string }) => document.title),
		).toEqual(["First paper", "Second paper"]);
	});

	it("answers chat with the bounded agent", async () => {
		const response = await chat(chatRequest());

		expect(await response.text()).toBe("agent answer");
		const options = mocks.createResearchAgent.mock.calls[0]?.[0];
		expect(options.mode).toBe("quick");
		expect(options.selectedModel).toMatchObject({
			provider: "openrouter",
			modelId: "openai/gpt-5.6-luna",
		});
		expect(options.companyName).toBe("Evidence Library");
	});

	it("gives the agent the publication the reader has open", async () => {
		await chat(chatRequest({ itemKey: "ITEM0001" }));

		const validated = mocks.validateMessages.mock.results[0];
		expect(validated).toBeDefined();
		const messages = mocks.convertToModelMessages.mock.calls[0]?.[0];
		const contextPart = messages[0].parts.find(
			(part: { type: string }) => part.type === "data-requestContext",
		);
		expect(contextPart.data.currentPublication).toEqual({
			key: "ITEM0001",
			title: "Teaching by radio",
		});
	});

	it("refuses a model this library does not offer", async () => {
		const response = await chat(
			chatRequest({ modelId: "anthropic/claude-opus-5" }),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "MODEL_UNAVAILABLE" },
		});
		expect(mocks.createResearchAgent).not.toHaveBeenCalled();
	});

	it("refuses a chat request that is missing its model", async () => {
		const response = await chat(chatRequest({ modelId: undefined }));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "INVALID_REQUEST" },
		});
	});

	it("refuses deep research when the library switched it off", async () => {
		mocks.libraryConfig.features = {
			ai: true,
			aiSearch: true,
			deepResearch: false,
		};

		const response = await chat(chatRequest({ mode: "research" }));

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "AI_DISABLED" },
		});
	});
});
