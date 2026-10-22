import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	convertToModelMessages: vi.fn(async (messages) => messages),
	readReaderListKeys: vi.fn(),
	getSignedInReader: vi.fn(),
	createUIMessageStreamResponse: vi.fn(),
	createResearchAgent: vi.fn(),
	generateText: vi.fn(),
	getCachedItemSmall: vi.fn(),
	loadPublication: vi.fn(),
	loadPublicationMetadata: vi.fn(),
	provider: vi.fn(),
	stream: vi.fn(),
	streamText: vi.fn(),
	trackAIUsage: vi.fn(),
	toUIMessageStream: vi.fn(),
	validateMessages: vi.fn(),
	libraryConfig: {
		ai: {
			providers: [
				{
					provider: "openrouter",
					enabled: true,
					apiKey: "openrouter-key",
					models: [
						"openai/gpt-5.6-luna",
						"x-ai/grok-4.6",
						"google/gemini-3.7-flash",
					],
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
vi.mock("@/db", () => ({ getDatabaseForConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/readers/data", () => ({ readReaderListKeys: mocks.readReaderListKeys }));
vi.mock("@/lib/readers/session", () => ({ getSignedInReader: mocks.getSignedInReader }));
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
	getCachedItemSmall: mocks.getCachedItemSmall,
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
	createUIMessageStreamResponse: mocks.createUIMessageStreamResponse,
	generateText: mocks.generateText,
	Output: { object: vi.fn((options) => options) },
	safeValidateUIMessages: mocks.validateMessages,
	streamText: mocks.streamText,
	toUIMessageStream: mocks.toUIMessageStream,
}));

import { POST as chat } from "@/app/api/ai/chat/route";
import { POST as questions } from "@/app/api/ai/questions/route";
import { POST as screen } from "@/app/api/ai/screen/route";
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
		// The provider builds the model a route has already allowed.
		mocks.provider.mockResolvedValue({
			createModel: vi.fn((modelId: string) => ({ id: modelId })),
		});
		mocks.createUIMessageStreamResponse.mockImplementation(
			({ stream }) => new Response(stream),
		);
		mocks.toUIMessageStream.mockImplementation(({ stream }) => stream);
		mocks.streamText.mockReturnValue({ stream: "summary" });
		mocks.stream.mockResolvedValue({ stream: "agent answer" });
		mocks.createResearchAgent.mockReturnValue({
			tools: { searchLibrary: {}, readPublications: {} },
			stream: mocks.stream,
		});
		mocks.validateMessages.mockResolvedValue({
			success: true,
			data: [{ id: "message-1", role: "user", parts: [] }],
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
		mocks.getCachedItemSmall.mockImplementation(async (key: string) => ({
			item: {
				key,
				title: `Publication ${key}`,
				abstractNote: `<p>About ${key}</p>`,
			},
		}));
		mocks.generateText.mockResolvedValue({
			output: {
				questions: ["One?", "Two?", "Three?", "Four?", "Five?"],
				results: [
					{
						key: "ITEM0001",
						screeningFields: { field_0: "Kenya", field_1: true },
					},
				],
			},
			providerMetadata: {},
			response: { headers: {} },
			usage: { totalTokens: 30 },
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
		const call = mocks.generateText.mock.calls[0]?.[0];
		expect(call.prompt).toContain("Radio lessons reached rural schools.");
		expect(call.prompt).not.toContain("fullTextPDF");
		expect(mocks.loadPublication).not.toHaveBeenCalled();
	});

	it("runs starter questions on the library's cheap fixed model", async () => {
		await questions(post("/api/ai/questions", { prompt: "ITEM0001" }));

		expect(mocks.generateText.mock.calls[0]?.[0].model).toEqual({
			id: "openai/gpt-6-luna",
		});
	});

	it("screens each publication against the reader's own questions", async () => {
		const response = await screen(
			post("/api/ai/screen", {
				keys: ["ITEM0001", "ITEM0002"],
				modelId: "openai/gpt-5.6-luna",
				fields: [
					{
						label: "Country",
						description: "Which country the study covers",
						type: "string",
					},
					{
						label: "Randomised",
						description: "Whether the study was randomised",
						type: "boolean",
					},
				],
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			ITEM0001: {
				title: "Publication ITEM0001",
				screeningFields: { Country: "Kenya", Randomised: true },
			},
			ITEM0002: {
				title: "Publication ITEM0002",
				screeningFields: { Country: null, Randomised: null },
			},
		});
	});

	it("sends only titles and abstracts to the model", async () => {
		await screen(
			post("/api/ai/screen", {
				keys: ["ITEM0001"],
				modelId: "openai/gpt-5.6-luna",
				fields: [
					{
						label: "Country",
						description: "Which country the study covers",
						type: "string",
					},
				],
			}),
		);

		const prompt = String(mocks.generateText.mock.calls[0]?.[0].prompt);
		expect(prompt).toContain("About ITEM0001");
		expect(prompt).not.toContain("fullTextPDF");
	});

	it("refuses to screen more than twenty-five publications at once", async () => {
		const response = await screen(
			post("/api/ai/screen", {
				keys: Array.from({ length: 26 }, (_, index) => `KEY${index}`),
				modelId: "openai/gpt-5.6-luna",
				fields: [
					{
						label: "Country",
						description: "Which country the study covers",
						type: "string",
					},
				],
			}),
		);

		expect(response.status).toBe(400);
		expect(mocks.generateText).not.toHaveBeenCalled();
	});

	it("says when none of the publications exist", async () => {
		mocks.getCachedItemSmall.mockResolvedValue({ item: null });

		const response = await screen(
			post("/api/ai/screen", {
				keys: ["MISSING1"],
				modelId: "openai/gpt-5.6-luna",
				fields: [
					{
						label: "Country",
						description: "Which country the study covers",
						type: "string",
					},
				],
			}),
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "ITEM_NOT_FOUND" },
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

	it("gives the agent the publication context even when it has no PDF", async () => {
		const { getCachedItem } = await import("@/app/api/cache");
		const publication = await getCachedItem("ITEM0001");
		if (!publication?.item) throw new Error("Missing publication fixture");
		vi.mocked(getCachedItem).mockResolvedValueOnce({...publication, item: {...publication.item, attachmentsData: []}});
		const response = await chat(chatRequest({ itemKey: "ITEM0001" }));
		expect(response.status).toBe(200);
		const { getAISystemPrompt } = await import("@/lib/ai-prompts");
		expect(vi.mocked(getAISystemPrompt).mock.calls.at(-1)?.[2]).toMatchObject({hasPdf: false});

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

	it("tells the agent which results the reader is looking at", async () => {
		const searchContext = {
			search: "teacher training",
			scope: "title_and_abstract",
			sort: "relevance",
			range: "2019-2024",
			institution: ["EdTech Hub"],
			country: [],
			author: "",
			collections: [],
			topics: ["T12260"],
			type: [],
		};

		await chat(chatRequest({ searchContext }));

		const expected = { ...searchContext, author_country: [], sources: [], study: [], match: "", readerList: null };
		expect(
			mocks.createResearchAgent.mock.calls[0]?.[0].searchContext,
		).toEqual(expected);
		const messages = mocks.convertToModelMessages.mock.calls[0]?.[0];
		const contextPart = messages[0].parts.find(
			(part: { type: string }) => part.type === "data-requestContext",
		);
		expect(contextPart.data.searchContext).toEqual(expected);
	});

	it("refuses a chat request whose result list was tampered with", async () => {
		const response = await chat(
			chatRequest({
				searchContext: {
					search: "teacher training",
					scope: "everything",
				},
			}),
		);

		expect(response.status).toBe(400);
		expect(mocks.createResearchAgent).not.toHaveBeenCalled();
	});

	describe("on a reader's profile", () => {
		const profileContext = (collectionId: string) => ({
			search: "",
			scope: "",
			sort: "relevance",
			range: "",
			institution: [],
			country: [],
			author: "",
			collections: [],
			topics: [],
			type: [],
			readerList: { userId: "reader-amina", collectionId },
		});

		beforeEach(() => {
			mocks.libraryConfig.features = { ai: true, aiSearch: true, deepResearch: true, readerAccounts: true };
			mocks.getSignedInReader.mockResolvedValue({ id: "reader-visitor", name: "", image: null, clerkUserId: "user_visitor" });
		});

		it("refuses someone else's private collection before the model sees anything", async () => {
			mocks.readReaderListKeys.mockResolvedValue({ refused: 403 });
			const response = await chat(chatRequest({ searchContext: profileContext("6b3a8f2e-1c4d-4e5f-8a9b-0c1d2e3f4a5b") }));

			expect(response.status).toBe(403);
			expect(mocks.readReaderListKeys.mock.calls[0]?.[2]).toBe("reader-visitor");
			expect(mocks.createResearchAgent).not.toHaveBeenCalled();
		});

		it("gives the agent exactly the records of the list the reader is looking at", async () => {
			mocks.readReaderListKeys.mockResolvedValue({ keys: ["SAVED001", "SAVED002"], collection: null });
			await chat(chatRequest({ searchContext: profileContext("") }));

			expect(mocks.createResearchAgent.mock.calls[0]?.[0].readerList.keys).toEqual(["SAVED001", "SAVED002"]);
		});

		it("tells the agent which collection the reader has open", async () => {
			const collection = { name: "Teacher coaching", description: "Coaching studies in low-income countries" };
			mocks.readReaderListKeys.mockResolvedValue({ keys: ["SAVED001"], collection });
			await chat(chatRequest({ searchContext: profileContext("6b3a8f2e-1c4d-4e5f-8a9b-0c1d2e3f4a5b") }));

			expect(mocks.createResearchAgent.mock.calls[0]?.[0].readerList.collection).toEqual(collection);
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
