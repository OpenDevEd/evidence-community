import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	convertToModelMessages: vi.fn(async (messages) => messages),
	createResearchAgent: vi.fn(),
	generateObject: vi.fn(),
	loadPublication: vi.fn(),
	loadPublicationMetadata: vi.fn(),
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
// Only the download boundary is faked. The parts a publication sends to the
// model stay real.
vi.mock("@/lib/ai/attachments", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/ai/attachments")>()),
	loadPublication: mocks.loadPublication,
	loadPublicationMetadata: mocks.loadPublicationMetadata,
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
		// Each configured slot answers with the model it names, so a test can
		// see which model a route chose.
		mocks.provider.mockResolvedValue({
			createModel: vi.fn((modelId: string) => ({ id: modelId })),
			defaultModel: { id: "openai/gpt-5.6-luna" },
			defaultModelId: "openai/gpt-5.6-luna",
			largeModel: { id: "x-ai/grok-4.6" },
			largeModelId: "x-ai/grok-4.6",
			smallModel: { id: "google/gemini-3.7-flash" },
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
		mocks.loadPublication.mockResolvedValue({
			key: "ITEM0001",
			title: "Teaching by radio",
			metadata: {
				key: "ITEM0001",
				title: "Teaching by radio",
				abstract: "Radio lessons reached rural schools.",
			},
			files: [
				{
					attachmentKey: "PDF00001",
					filename: "teaching-by-radio.pdf",
					source: { type: "data", data: new Uint8Array([37, 80]) },
				},
			],
			unavailable: [],
		});
		mocks.loadPublicationMetadata.mockResolvedValue({
			key: "ITEM0001",
			title: "Teaching by radio",
			metadata: {
				key: "ITEM0001",
				title: "Teaching by radio",
				abstract: "Radio lessons reached rural schools.",
			},
		});
	});

	it("summarizes a publication from its own PDF", async () => {
		const response = await publication(
			post("/api/ai", {
				prompt: "ITEM0001",
				feature: "summarize",
				modelId: "openai/gpt-5.6-luna",
			}),
		);

		expect(await response.text()).toBe("summary");
		const call = mocks.streamText.mock.calls[0]?.[0];
		expect(call.model).toEqual({ id: "openai/gpt-5.6-luna" });

		const parts = call.messages[0].content as Array<{
			type: string;
			text?: string;
			mediaType?: string;
		}>;
		expect(parts.some((part) => part.mediaType === "application/pdf")).toBe(
			true,
		);
		const text = parts
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		expect(text).toContain(
			"[PAGE /lib/ITEM0001/download/PDF00001 — PAGE_NUMBER PAGE/]",
		);
		expect(text).toContain("Summarize this publication.");
	});

	it("refuses a publication request for something other than summary or explain", async () => {
		const response = await publication(
			post("/api/ai", {
				prompt: "ITEM0001",
				feature: "rewrite",
				modelId: "openai/gpt-5.6-luna",
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "INVALID_REQUEST" },
		});
		expect(mocks.streamText).not.toHaveBeenCalled();
	});

	it("refuses a publication request for a model this library does not offer", async () => {
		const response = await publication(
			post("/api/ai", {
				prompt: "ITEM0001",
				feature: "explain",
				modelId: "anthropic/claude-opus-5",
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "MODEL_UNAVAILABLE" },
		});
	});

	it("says when the publication does not exist", async () => {
		mocks.loadPublication.mockResolvedValue(null);

		const response = await publication(
			post("/api/ai", {
				prompt: "MISSING1",
				feature: "summarize",
				modelId: "openai/gpt-5.6-luna",
			}),
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "ITEM_NOT_FOUND" },
		});
	});

	it("generates five starter questions from metadata alone", async () => {
		const response = await questions(
			post("/api/ai/questions", { prompt: "ITEM0001" }),
		);

		expect(await response.json()).toEqual([
			"One?",
			"Two?",
			"Three?",
			"Four?",
			"Five?",
		]);
		const call = mocks.generateObject.mock.calls[0]?.[0];
		expect(call.prompt).toContain("Radio lessons reached rural schools.");
		expect(call.prompt).not.toContain("fullTextPDF");
		expect(mocks.loadPublication).not.toHaveBeenCalled();
	});

	it("runs starter questions on the library's cheap fixed model", async () => {
		await questions(post("/api/ai/questions", { prompt: "ITEM0001" }));

		expect(mocks.generateObject.mock.calls[0]?.[0].model).toEqual({
			id: "openai/gpt-5.6-luna",
		});
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
