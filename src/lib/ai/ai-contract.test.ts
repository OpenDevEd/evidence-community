import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_AI_MODEL_ID,
	AI_MODELS,
	isAIModelId,
	isSelectableAIModelId,
	reasoningEffort,
	STARTER_QUESTIONS_MODEL_ID,
} from "./models";
import {
	chatRequestSchema,
	publicationGenerationSchema,
	SMART_SCREENING_LIMITS,
	screeningRequestSchema,
} from "./schemas";
import {
	createResearchToolSchemas,
	validateSearchFiltersAgainstUserRequest,
} from "./tool-schemas";
import { asSchema, generateText, type UIMessage } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
	hasVisiblePdfAttachment,
	isVisiblePdfAttachment,
} from "../attachment-visibility";
import { getOpenAlexPdfUrl } from "../openalex";
import {
	buildPdfDownloadPath,
	parsePageCitation,
	pdfFilename,
} from "./citations";
import { clientAIError, uiMessageReasoningText, uiMessageText } from "./client";
import { normalizeAIError } from "./errors";
import { FULL_TEXT_PDF_FILTER } from "../search-filter-constants";
import { upsertAIHistory } from "./history";
import {
	currentDateContext,
	EVIDENCE_CITATION_INSTRUCTIONS,
} from "./prompt-context";
import { screeningExportContent } from "./screening-export";
import { chatMessageContent, chatTranscriptContent } from "./transcript-export";
import {
	createOpenRouterSessionId,
	createOpenRouterModelSettings,
	openRouterExplicitCacheProviderOptions,
	openRouterResponseCacheHeaders,
	OPENROUTER_RESPONSE_CACHE_TTL,
} from "./openrouter-cache";
import { SORT_OPTIONS } from "@/constants/items";
import { normalizeLibrarySearchContext } from "../search-context";
import {
	createResearchRequestContextSnapshot,
	latestResearchRequestContext,
	researchRequestContextsEqual,
	researchRequestContextPart,
	researchRequestContextText,
} from "./request-context";
import {
	createCurrentResultsCursor,
	currentResultsOffset,
	CURRENT_RESULTS_WINDOW_SIZE,
} from "./current-results-cursor";
import { toolActivitySummary, type ResearchToolPart } from "./tool-activity";
import { screeningSelection } from "./screening-selection";

const SELECTABLE_MODEL_IDS = [
	"anthropic/claude-haiku-5.5",
	"openai/gpt-6-luna",
	"google/gemini-4-hydrogen",
] as const;
const CLAUDE_HAIKU_MODEL_ID = "anthropic/claude-haiku-5.5" as const;

test("the AI offers Haiku, Luna and Hydrogen, each at its own reasoning effort, with Luna the default", () => {
	assert.deepEqual(
		AI_MODELS.map(({ id }) => id),
		SELECTABLE_MODEL_IDS,
	);
	assert.deepEqual(
		AI_MODELS.filter(({ hidden }) => !hidden).map(({ id }) => id),
		SELECTABLE_MODEL_IDS,
	);
	assert.equal(DEFAULT_AI_MODEL_ID, "openai/gpt-6-luna");
	assert.equal(STARTER_QUESTIONS_MODEL_ID, "openai/gpt-6-luna");
	assert.equal(isAIModelId("google/gemini-3.7-flash"), false);
	assert.equal(isAIModelId("anthropic/claude-sonnet-5"), false);
	assert.equal(isSelectableAIModelId(CLAUDE_HAIKU_MODEL_ID), true);
	assert.equal(reasoningEffort(CLAUDE_HAIKU_MODEL_ID), "medium");
	assert.equal(reasoningEffort("openai/gpt-6-luna"), "medium");
	assert.equal(reasoningEffort("google/gemini-4-hydrogen"), "low");
	assert.equal(
		publicationGenerationSchema.safeParse({
			prompt: "ITEM123",
			feature: "summarize",
			modelId: "anthropic/claude-sonnet-5",
		}).success,
		false,
	);
});

test("OpenRouter cache settings are stable and regeneration can refresh responses", () => {
	const sessionId = createOpenRouterSessionId(
		"publication",
		DEFAULT_AI_MODEL_ID,
		"en-GB",
		"ITEM123",
	);
	assert.equal(
		sessionId,
		createOpenRouterSessionId(
			"publication",
			DEFAULT_AI_MODEL_ID,
			"en-GB",
			"ITEM123",
		),
	);
	assert.notEqual(
		sessionId,
		createOpenRouterSessionId(
			"publication",
			DEFAULT_AI_MODEL_ID,
			"en-GB",
			"ITEM456",
		),
	);
	assert.ok(sessionId.length <= 256);
	assert.equal(
		openRouterExplicitCacheProviderOptions(DEFAULT_AI_MODEL_ID),
		undefined,
	);
	assert.deepEqual(
		openRouterExplicitCacheProviderOptions(CLAUDE_HAIKU_MODEL_ID),
		{
			openrouter: {
				cacheControl: { type: "ephemeral", ttl: "1h" },
			},
		},
	);
	assert.equal(
		Reflect.has(
			createOpenRouterModelSettings(DEFAULT_AI_MODEL_ID),
			"cache_control",
		),
		false,
	);
	// Gemini's thought signatures only work on the host that produced them.
	assert.deepEqual(
		createOpenRouterModelSettings("google/gemini-4-hydrogen").provider,
		{ order: ["google-ai-studio"], allow_fallbacks: false },
	);
	assert.deepEqual(
		createOpenRouterModelSettings(DEFAULT_AI_MODEL_ID, { sessionId }),
		{
			usage: { include: true },
			reasoning: { effort: "medium" },
			provider: {
				order: ["amazon-bedrock/us-east-1"],
				allow_fallbacks: true,
			},
			extraBody: { session_id: sessionId },
		},
	);
	assert.deepEqual(
		openRouterResponseCacheHeaders(OPENROUTER_RESPONSE_CACHE_TTL.chat),
		{
			"X-OpenRouter-Cache": "true",
			"X-OpenRouter-Cache-TTL": "300",
		},
	);
	assert.deepEqual(
		openRouterResponseCacheHeaders(OPENROUTER_RESPONSE_CACHE_TTL.chat, {
			refresh: true,
		}),
		{
			"X-OpenRouter-Cache": "true",
			"X-OpenRouter-Cache-TTL": "300",
			"X-OpenRouter-Cache-Clear": "true",
		},
	);
});

test("chat request context snapshots remain in place and append only when context changes", () => {
	const first = createResearchRequestContextSnapshot({
		now: new Date("2026-08-19T10:00:00.000Z"),
		searchContext: normalizeLibrarySearchContext({ search: "test" }),
	});
	const unchanged = createResearchRequestContextSnapshot({
		now: new Date("2026-08-19T18:00:00.000Z"),
		searchContext: normalizeLibrarySearchContext({ search: "test" }),
	});
	const changed = createResearchRequestContextSnapshot({
		now: new Date("2026-08-20T00:00:00.000Z"),
		searchContext: normalizeLibrarySearchContext({ search: "teacher" }),
	});
	const firstPart = researchRequestContextPart(first);
	const messages = [
		{
			parts: [firstPart, { type: "text", text: "First question" }],
		},
	];

	assert.equal(researchRequestContextsEqual(first, unchanged), true);
	assert.equal(researchRequestContextsEqual(first, changed), false);
	assert.deepEqual(latestResearchRequestContext(messages), first);

	const withChangedContext = [
		...messages,
		{
			parts: [
				researchRequestContextPart(changed),
				{ type: "text", text: "Next question" },
			],
		},
	];
	assert.strictEqual(messages[0].parts[0], firstPart);
	assert.deepEqual(latestResearchRequestContext(withChangedContext), changed);
	assert.match(researchRequestContextText(first), /2026-08-19/);
	assert.match(researchRequestContextText(changed), /teacher/);
});

test("the OpenRouter adapter emits Claude automatic caching, PDF breakpoints, sessions, and response-cache headers", async () => {
	let requestBody: unknown;
	let requestHeaders: Headers | undefined;
	const mockFetch: typeof fetch = async (_input, init) => {
		requestBody = JSON.parse(String(init?.body));
		requestHeaders = new Headers(init?.headers);
		return new Response(
			JSON.stringify({
				id: "generation-test",
				model: CLAUDE_HAIKU_MODEL_ID,
				provider: "test",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "Done" },
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 1,
					total_tokens: 11,
					prompt_tokens_details: {
						cached_tokens: 8,
						cache_write_tokens: 2,
					},
				},
			}),
			{
				status: 200,
				headers: {
					"content-type": "application/json",
					"x-openrouter-cache-status": "MISS",
				},
			},
		);
	};
	const openrouter = createOpenRouter({
		apiKey: "test-key",
		compatibility: "strict",
		fetch: mockFetch,
	});
	const sessionId = "publication:test-session";
	const result = await generateText({
		model: openrouter(
			CLAUDE_HAIKU_MODEL_ID,
			createOpenRouterModelSettings(CLAUDE_HAIKU_MODEL_ID, {
				sessionId,
			}),
		),
		messages: [
			{
				role: "user",
				content: [
					{
						type: "file",
						mediaType: "application/pdf",
						filename: "test.pdf",
						data: new Uint8Array([37, 80, 68, 70, 45]),
						providerOptions: openRouterExplicitCacheProviderOptions(
							CLAUDE_HAIKU_MODEL_ID,
						),
					},
					{ type: "text", text: "Summarize this PDF." },
				],
			},
		],
		headers: openRouterResponseCacheHeaders(300),
	});

	assert.ok(requestBody && typeof requestBody === "object");
	assert.equal(Reflect.get(requestBody, "session_id"), sessionId);
	// Every request carries the model's own reasoning effort.
	assert.deepEqual(Reflect.get(requestBody, "reasoning"), { effort: "medium" });
	assert.equal(Reflect.has(requestBody, "prompt_cache_key"), false);
	assert.deepEqual(Reflect.get(requestBody, "cache_control"), {
		type: "ephemeral",
		ttl: "1h",
	});
	const messages = Reflect.get(requestBody, "messages");
	assert.ok(Array.isArray(messages));
	const content = Reflect.get(messages[0], "content");
	assert.ok(Array.isArray(content));
	assert.deepEqual(Reflect.get(content[0], "cache_control"), {
		type: "ephemeral",
		ttl: "1h",
	});
	assert.equal(Reflect.has(content[1], "cache_control"), false);
	assert.equal(requestHeaders?.get("x-openrouter-cache"), "true");
	assert.equal(requestHeaders?.get("x-openrouter-cache-ttl"), "300");
	assert.equal(result.usage.inputTokenDetails.cacheReadTokens, 8);
	assert.equal(result.usage.inputTokenDetails.cacheWriteTokens, 2);
	assert.equal(
		result.response.headers?.["x-openrouter-cache-status"],
		"MISS",
	);
});

test("AI history keeps the current entry first without mutating older entries", () => {
	const older = {
		id: "older",
		title: "Older publication",
		key: "OLDER",
		content: "Older answer",
		date: new Date("2026-01-01T00:00:00.000Z"),
		modelId: "openai/gpt-5.6-luna" as const,
	};
	const current = {
		...older,
		id: "current",
		title: "Current publication",
		content: "Streaming answer",
	};
	const original = [older];
	const withCurrent = upsertAIHistory(original, current);

	assert.deepEqual(
		withCurrent.map(({ id }) => id),
		["current", "older"],
	);
	assert.deepEqual(
		original.map(({ id }) => id),
		["older"],
	);
	assert.equal(
		upsertAIHistory(withCurrent, {
			...current,
			content: "Finished answer",
		}).filter(({ id }) => id === "current").length,
		1,
	);
});

test("PDF visibility exactly matches the publication attachment list", () => {
	assert.equal(
		isVisiblePdfAttachment({ PDFCoverPageImage: "cover.jpg" }),
		true,
	);
	assert.equal(isVisiblePdfAttachment({ tags: ["_AUTO-PROCESS"] }), true);
	assert.equal(isVisiblePdfAttachment({ tags: ["_ai_enabled"] }), false);
	assert.equal(
		hasVisiblePdfAttachment({
			attachmentsData: [{ tags: ["other"] }, { tags: ["_auto-process"] }],
		}),
		true,
	);
});

test("AI request schemas reject unknown models and oversized screening batches", () => {
	assert.equal(
		publicationGenerationSchema.safeParse({
			prompt: "ABCDEFGH",
			feature: "summarize",
			modelId: "openai/gpt-5.6-terra",
		}).success,
		false,
	);
	assert.equal(
		chatRequestSchema.safeParse({
			id: "chat-1",
			messages: [{}],
			trigger: "submit-message",
			modelId: DEFAULT_AI_MODEL_ID,
			mode: "full",
		}).success,
		false,
	);
	assert.equal(
		screeningRequestSchema.safeParse({
			keys: Array.from({ length: 26 }, (_, index) => `KEY${index}`),
			modelId: DEFAULT_AI_MODEL_ID,
			fields: [
				{
					label: "Relevant",
					description: "Is it relevant?",
					type: "boolean",
				},
			],
		}).success,
		false,
	);
});

test("Smart Screening uses one set of request limits", () => {
	const validDescription = "x".repeat(
		SMART_SCREENING_LIMITS.descriptionCharacters.min,
	);
	const validField = {
		label: "Relevant",
		description: validDescription,
		type: "boolean" as const,
	};

	assert.equal(
		screeningRequestSchema.safeParse({
			keys: ["ITEM1"],
			modelId: DEFAULT_AI_MODEL_ID,
			fields: [validField],
		}).success,
		true,
	);
	assert.equal(
		screeningRequestSchema.safeParse({
			keys: ["ITEM1"],
			modelId: DEFAULT_AI_MODEL_ID,
			fields: [
				{
					...validField,
					description: validDescription.slice(1),
				},
			],
		}).success,
		false,
	);
	assert.equal(
		screeningRequestSchema.safeParse({
			keys: ["ITEM1"],
			modelId: DEFAULT_AI_MODEL_ID,
			fields: Array.from(
				{ length: SMART_SCREENING_LIMITS.fields + 1 },
				(_, index) => ({ ...validField, label: `Field ${index}` }),
			),
		}).success,
		false,
	);
});

test("Smart Screening reports citations omitted from its bounded batch", () => {
	const content = Array.from(
		{ length: SMART_SCREENING_LIMITS.items + 2 },
		(_, index) => `[Publication ${index}](/lib/ITEM${index})`,
	).join("\n");
	const selection = screeningSelection(`${content}\n[Duplicate](/lib/ITEM0)`);

	assert.equal(selection.keys.length, SMART_SCREENING_LIMITS.items);
	assert.equal(selection.total, SMART_SCREENING_LIMITS.items + 2);
	assert.equal(selection.omitted, 2);
});

test("chat requests accept the current AI SDK transport envelope", () => {
	const request = {
		id: "chat-1",
		messages: [
			{
				id: "message-1",
				role: "user",
				parts: [{ type: "text", text: "Hello" }],
			},
		],
		trigger: "submit-message" as const,
		modelId: DEFAULT_AI_MODEL_ID,
		mode: "quick" as const,
	};

	assert.equal(chatRequestSchema.safeParse(request).success, true);
	assert.equal(
		chatRequestSchema.safeParse({ ...request, unexpected: true }).success,
		false,
	);
});

test("chat requests accept only normalized current-library search context", () => {
	const request = {
		id: "chat-1",
		messages: [{ id: "message-1", role: "user", parts: [] }],
		trigger: "submit-message" as const,
		modelId: DEFAULT_AI_MODEL_ID,
		mode: "quick" as const,
		searchContext: normalizeLibrarySearchContext({
			search: "teacher development",
			country: ["MA"],
			sort: "desc",
		}),
	};

	assert.equal(chatRequestSchema.safeParse(request).success, true);
	assert.equal(
		chatRequestSchema.safeParse({
			...request,
			searchContext: { ...request.searchContext, scope: "not-a-scope" },
		}).success,
		false,
	);
	assert.equal(
		chatRequestSchema.safeParse({
			...request,
			searchContext: { ...request.searchContext, page: 4 },
		}).success,
		false,
	);
});

test("current-result cursors are stateless, windowed, and tied to the search", () => {
	const context = normalizeLibrarySearchContext({
		search: "education technology",
		country: ["TN"],
	});
	const cursor = createCurrentResultsCursor(
		context,
		CURRENT_RESULTS_WINDOW_SIZE,
	);

	assert.equal(currentResultsOffset(context), 0);
	assert.equal(
		currentResultsOffset(context, cursor),
		CURRENT_RESULTS_WINDOW_SIZE,
	);
	assert.throws(
		() =>
			currentResultsOffset(
				normalizeLibrarySearchContext({
					...context,
					country: ["EG"],
				}),
				cursor,
			),
		/current library search changed/i,
	);
});

test("tool schemas enforce parallel-search and publication-read bounds", () => {
	const quick = createResearchToolSchemas("quick");
	const research = createResearchToolSchemas("research");

	assert.equal(
		quick.searchLibrary.safeParse({ queries: ["education"] }).success,
		true,
	);
	assert.equal(
		research.searchLibrary.safeParse({ queries: ["education"] }).success,
		false,
	);
	assert.equal(
		research.searchLibrary.safeParse({ queries: ["education", "learning"] })
			.success,
		true,
	);
	assert.equal(
		quick.searchLibrary.safeParse({
			queries: ["a", "b", "c", "d", "e", "f"],
		}).success,
		false,
	);
	assert.equal(
		quick.readPublications.safeParse({
			itemKeys: ["1", "2", "3", "4", "5", "6"],
		}).success,
		false,
	);
	assert.equal(
		research.readPublications.safeParse({
			itemKeys: Array.from({ length: 10 }, (_, index) => `KEY${index}`),
		}).success,
		true,
	);
	assert.equal(
		research.searchLibrary.safeParse({
			queries: ["education", "learning"],
			filters: { fullTextOnly: true },
		}).success,
		true,
	);
	assert.equal(
		research.searchLibrary.safeParse({
			queries: ["education", "learning"],
			filters: { fullTextOnly: "yes" },
		}).success,
		false,
	);
	assert.equal(
		research.searchLibrary.safeParse({
			queries: ["education", "learning"],
			filters: { year: 2026 },
		}).success,
		false,
	);
	assert.equal(
		quick.searchLibrary.safeParse({
			queries: ["education"],
			withinCurrentResults: true,
			cursor: "next-window",
		}).success,
		true,
	);
	assert.equal(FULL_TEXT_PDF_FILTER, "fullTextPDFs.fullTextPDF.text EXISTS");
});

test("current-results listing needs no queries, but plain searches still do", () => {
	const quick = createResearchToolSchemas("quick");
	const research = createResearchToolSchemas("research");
	// Listing the user's own results: no queries, optional last window.
	assert.equal(
		quick.searchLibrary.safeParse({ withinCurrentResults: true }).success,
		true,
	);
	assert.equal(
		research.searchLibrary.safeParse({
			withinCurrentResults: true,
			window: "last",
		}).success,
		true,
	);
	// A library search without queries is still rejected, with guidance.
	const missing = quick.searchLibrary.safeParse({ queries: [] });
	assert.equal(missing.success, false);
	assert.match(
		JSON.stringify(missing.success ? null : missing.error.issues),
		/withinCurrentResults=true/,
	);
	assert.equal(
		research.searchLibrary.safeParse({ queries: ["only one"] }).success,
		false,
	);
	// Strict-mode providers send every property (window, empty cursor,
	// empty filter arrays): a plain search must still validate.
	const strictShaped = quick.searchLibrary.safeParse({
		queries: ["education"],
		withinCurrentResults: false,
		window: "first",
		cursor: "",
		filters: {
			country: [],
			institution: [],
			collection: [],
			fullTextOnly: true,
		},
		limitPerQuery: 5,
	});
	assert.equal(strictShaped.success, true);
});

test("search context normalisation never throws on transient URL states", () => {
	// "-" is range mode with no years picked yet; it carries no constraint.
	assert.equal(normalizeLibrarySearchContext({ range: "-" }).range, "");
	assert.equal(
		normalizeLibrarySearchContext({ range: "2015-" }).range,
		"2015-",
	);
	assert.equal(normalizeLibrarySearchContext({ range: "garbage" }).range, "");
	assert.equal(
		normalizeLibrarySearchContext({ sort: "nope" }).sort,
		SORT_OPTIONS[0].key,
	);
});

test("preferred OpenRouter providers are requested per model with fallbacks", () => {
	const luna = createOpenRouterModelSettings("openai/gpt-6-luna") as {
		provider?: { order: string[]; allow_fallbacks: boolean };
	};
	assert.deepEqual(luna.provider, {
		order: ["amazon-bedrock/us-east-1"],
		allow_fallbacks: true,
	});
	const gemini = createOpenRouterModelSettings("google/gemini-4-hydrogen") as {
		provider?: { order: string[] };
	};
	assert.deepEqual(gemini.provider?.order, ["google-ai-studio"]);
	const haiku = createOpenRouterModelSettings(CLAUDE_HAIKU_MODEL_ID) as {
		provider?: unknown;
	};
	assert.equal(haiku.provider, undefined);
});

test("current-results cursors may start at an unaligned offset (last window)", () => {
	const context = normalizeLibrarySearchContext({ search: "w" });
	const cursor = createCurrentResultsCursor(context, 155 - 200 + 200 + 37);
	assert.equal(currentResultsOffset(context, cursor), 192);
});

test("tool activity labels a current-results listing", () => {
	const listing = toolActivitySummary({
		type: "tool-searchLibrary",
		toolCallId: "tool-2",
		state: "output-available",
		input: { queries: [], withinCurrentResults: true, window: "last" },
		output: {
			queries: [],
			currentResults: {
				start: 1,
				end: 155,
				total: 155,
				hasMore: false,
				entries: [],
			},
		},
	} as ResearchToolPart);
	assert.equal(listing.title, "Read current results");
	assert.equal(listing.detail, "155 entries in displayed order");
});

test("tool activity distinguishes current-result searches and shows the window", () => {
	const running = toolActivitySummary({
		type: "tool-searchLibrary",
		toolCallId: "tool-1",
		state: "input-available",
		input: {
			queries: ["teacher training"],
			withinCurrentResults: true,
		},
	} as ResearchToolPart);
	assert.equal(running.title, "Searching current results");
	assert.deepEqual(running.currentResults, {
		start: undefined,
		end: undefined,
		total: undefined,
		hasMore: undefined,
	});

	const completed = toolActivitySummary({
		type: "tool-searchLibrary",
		toolCallId: "tool-1",
		state: "output-available",
		input: {
			queries: ["teacher training"],
			withinCurrentResults: true,
		},
		output: {
			queries: [{ hits: [{}, {}] }],
			currentResults: { start: 201, end: 400, total: 712, hasMore: true },
		},
	} as ResearchToolPart);
	assert.equal(completed.title, "Searched current results");
	assert.deepEqual(completed.currentResults, {
		start: 201,
		end: 400,
		total: 712,
		hasMore: true,
	});
	assert.equal(completed.detail, "2 results across 1 query");
});

test("year ranges use a provider-compatible exact-length array schema", async () => {
	const searchLibrary = createResearchToolSchemas("quick").searchLibrary;

	assert.equal(
		searchLibrary.safeParse({
			queries: ["education"],
			filters: { yearRange: [2020, 2025] },
		}).success,
		true,
	);
	assert.equal(
		searchLibrary.safeParse({
			queries: ["education"],
			filters: { yearRange: [2025, 2020] },
		}).success,
		false,
	);
	assert.equal(
		searchLibrary.safeParse({
			queries: ["education"],
			filters: { yearRange: [2020] },
		}).success,
		false,
	);

	const jsonSchema = await asSchema(searchLibrary).jsonSchema;
	const filters = jsonSchema.properties?.filters as {
		properties?: {
			yearRange?: {
				items?: unknown;
				minItems?: number;
				maxItems?: number;
			};
		};
	};
	const yearRange = filters.properties?.yearRange;

	assert.equal(Array.isArray(yearRange?.items), false);
	assert.equal(typeof yearRange?.items, "object");
	assert.equal(yearRange?.minItems, 2);
	assert.equal(yearRange?.maxItems, 2);
	assert.equal(
		(jsonSchema.properties?.filters as { description?: string })
			.description,
		"Optional constraints. Omit this object unless the user explicitly requested a matching filter. Never infer filters from the current date, topic, or expected result set.",
	);
});

test("unrequested model-generated year filters cannot narrow library searches", () => {
	assert.deepEqual(
		validateSearchFiltersAgainstUserRequest(
			{ yearRange: [1900, 3000], fullTextOnly: true },
			"give me 10 papers and citations about ai",
		),
		{
			effectiveFilters: { fullTextOnly: true },
			ignoredFilters: [
				"yearRange was ignored because the user did not request a date constraint",
			],
		},
	);
	assert.deepEqual(
		validateSearchFiltersAgainstUserRequest(
			{ yearRange: [2025, 2026], fullTextOnly: true },
			"find AI papers from the past 12 months",
		),
		{
			effectiveFilters: {
				yearRange: [2025, 2026],
				fullTextOnly: true,
			},
			ignoredFilters: [],
		},
	);
	assert.deepEqual(
		validateSearchFiltersAgainstUserRequest(
			{ yearRange: [2022, 2022] },
			"only include papers published in 2022",
		),
		{
			effectiveFilters: { yearRange: [2022, 2022] },
			ignoredFilters: [],
		},
	);
});

test("OpenAlex PDF selection prefers the best open-access location", () => {
	assert.equal(
		getOpenAlexPdfUrl({
			best_oa_location: {
				is_oa: true,
				pdf_url: "https://example.org/best.pdf",
			},
			locations: [
				{ is_oa: true, pdf_url: "https://example.org/other.pdf" },
			],
		}),
		"https://example.org/best.pdf",
	);
	assert.equal(
		getOpenAlexPdfUrl({
			locations: [
				{ is_oa: false, pdf_url: "https://example.org/closed.pdf" },
			],
		}),
		undefined,
	);
});

test("PDF citation data hides filenames and targets the cited page", () => {
	const path = buildPdfDownloadPath("ITEM1234", "PDF56789");
	assert.equal(path, "/lib/ITEM1234/download/PDF56789");
	assert.deepEqual(parsePageCitation(`${path} — 12`), {
		page: "12",
		href: "/lib/ITEM1234/download/PDF56789#page=12",
	});
	assert.deepEqual(
		parsePageCitation("Report.pdf — 7", { "Report.pdf": path }),
		{
			page: "7",
			href: "/lib/ITEM1234/download/PDF56789#page=7",
		},
	);
	assert.equal(pdfFilename({ key: "PDF", filename: "Report" }), "Report.pdf");
});

test("citation instructions require source-plus-page evidence and explicit publication displays", () => {
	assert.match(
		EVIDENCE_CITATION_INSTRUCTIONS,
		/MUST show both its publication source and the exact PDF page/i,
	);
	assert.match(
		EVIDENCE_CITATION_INSTRUCTIONS,
		/physical page position: the first page of the file is 1/i,
	);
	assert.match(
		EVIDENCE_CITATION_INSTRUCTIONS,
		/Never use page numbers printed in the document/i,
	);
	assert.match(
		EVIDENCE_CITATION_INSTRUCTIONS,
		/render the quotation as a Markdown blockquote/i,
	);
	assert.match(
		EVIDENCE_CITATION_INSTRUCTIONS,
		/Never place verbatim quotations inline inside a sentence, list item, table cell/i,
	);
	assert.match(
		EVIDENCE_CITATION_INSTRUCTIONS,
		/Search-result metadata and abstracts are discovery material/i,
	);
	assert.match(
		EVIDENCE_CITATION_INSTRUCTIONS,
		/PAGE token is the complete source-and-page display/i,
	);
	assert.match(
		EVIDENCE_CITATION_INSTRUCTIONS,
		/Never also write p\. 12, page 12, PDF p\. 12, a separate Source: line/i,
	);
	assert.match(EVIDENCE_CITATION_INSTRUCTIONS, /never on a separate line/i);
	assert.match(
		EVIDENCE_CITATION_INSTRUCTIONS,
		/Never write \[Source\]\(\/lib\/KEY\)/i,
	);
	assert.match(
		EVIDENCE_CITATION_INSTRUCTIONS,
		/\[Full publication title\]\(\/lib\/KEY\)/i,
	);
	assert.match(
		EVIDENCE_CITATION_INSTRUCTIONS,
		/\[RESOURCE \/lib\/KEY RESOURCE\/\]/i,
	);
});

test("AI failures and UI messages preserve useful details", () => {
	const conversationOverflow = normalizeAIError(
		{
			message: "Prompt rejected.",
			metadata: { error_type: "context_length_exceeded" },
		},
		{ context: "conversation" },
	);
	assert.equal(conversationOverflow.code, "CONTEXT_TOO_LARGE");
	assert.equal(conversationOverflow.status, 400);
	assert.equal(
		conversationOverflow.message,
		"This conversation is too long for the selected model. Reset the chat to continue.",
	);

	const documentOverflow = normalizeAIError(
		{
			message: "Bad request.",
			responseBody: JSON.stringify({
				error: {
					message: "Input exceeds the available tokens.",
					metadata: { error_type: "context_length_exceeded" },
				},
			}),
		},
		{ context: "document" },
	);
	assert.equal(documentOverflow.code, "DOCUMENT_TOO_LARGE");
	assert.equal(documentOverflow.status, 413);
	assert.equal(
		documentOverflow.message,
		"The attached document exceeds this model's context limit.",
	);

	assert.equal(
		clientAIError(
			new Error(
				JSON.stringify({
					error: {
						code: "MODEL_UNAVAILABLE",
						message: "Model is offline.",
					},
				}),
			),
		).message,
		"Model is offline.",
	);
	assert.equal(
		normalizeAIError(new Error("OpenRouter returned 503")).message,
		"The AI provider could not complete this request: OpenRouter returned 503",
	);
	assert.equal(
		normalizeAIError({
			code: 400,
			message: "The selected model rejected the PDF input.",
		}).message,
		"The AI provider could not complete this request: The selected model rejected the PDF input.",
	);
	assert.equal(
		normalizeAIError(
			new Error("[object Object]", {
				cause: { error: { message: "The provider is unavailable." } },
			}),
		).message,
		"The AI provider could not complete this request: The provider is unavailable.",
	);
	const gatewayError = normalizeAIError(
		Object.assign(
			new Error(
				"Failed after 3 attempts. Last error: AI_APICallError: Bad Gateway",
			),
			{
				lastError: Object.assign(new Error("Bad Gateway"), {
					statusCode: 502,
					responseBody:
						"<title>openrouter.ai | 502: Bad gateway</title>",
				}),
			},
		),
	);
	assert.equal(gatewayError.code, "PROVIDER_ERROR");
	assert.match(gatewayError.message, /rejected this request at its gateway/);
	assert.match(gatewayError.message, /fewer publications/);
	assert.equal(
		uiMessageText({
			id: "message",
			role: "assistant",
			parts: [
				{ type: "text", text: "streamed " },
				{ type: "text", text: "answer" },
			],
		}),
		"streamed answer",
	);
	assert.equal(
		uiMessageReasoningText({
			id: "message",
			role: "assistant",
			parts: [
				{ type: "reasoning", text: "First step", state: "done" },
				{ type: "text", text: "Answer" },
				{ type: "reasoning", text: "Second step", state: "done" },
			],
		}),
		"First step\n\nSecond step",
	);
});

test("AI prompts receive an exact date for relative-time requests", () => {
	assert.equal(
		currentDateContext(new Date("2026-08-18T15:30:00.000Z")),
		'The current date is 2026-08-18 (UTC). Resolve relative dates from this date; for example, "the past 12 months" means the rolling 12-month period ending today unless the user specifies a different interpretation.',
	);
});

test("screening exports are generated from structured results", () => {
	const exported = screeningExportContent(
		{
			fields: [
				{
					label: "Include | exclude",
					type: "boolean",
				},
			],
			result: {
				ITEM123: {
					title: '=Risky "title"',
					screeningFields: { "Include | exclude": true },
				},
			},
		},
		"https://example.org",
	);

	assert.match(exported.plaintext, /Key: ITEM123/);
	assert.match(exported.markdown, /Include \\| exclude/);
	assert.match(exported.html, /=Risky &quot;title&quot;/);
	assert.match(exported.csv, /"'=Risky ""title"""/);
	assert.match(exported.csv, /https:\/\/example\.org\/lib\/ITEM123/);
});

test("chat transcripts preserve part order and generate safe structured formats", async () => {
	const messages = [
		{
			id: "user-1",
			role: "user",
			parts: [{ type: "text", text: "Find evidence" }],
		},
		{
			id: "assistant-1",
			role: "assistant",
			parts: [
				{
					type: "reasoning",
					text: "I should search first.",
					state: "done",
				},
				{
					type: "tool-searchLibrary",
					toolCallId: "tool-1",
					state: "output-available",
					input: { queries: ["teacher AI"] },
					output: { queries: [{ hits: [{}, {}] }] },
				},
				{
					type: "text",
					text: "Interim answer",
				},
				{
					type: "tool-readPublications",
					toolCallId: "tool-2",
					state: "output-available",
					input: { itemKeys: ["ITEM"] },
					output: {},
				},
				{
					type: "text",
					text: "Final answer [PAGE /lib/ITEM/download/PDF — 4 PAGE/] <script>alert(1)</script> [unsafe](javascript:alert(1))",
				},
			],
		},
		{
			id: "screening-result",
			role: "assistant",
			parts: [
				{
					type: "text",
					text: JSON.stringify({
						fields: [{ label: "Relevant", type: "boolean" }],
						result: {
							ITEM: {
								title: "A useful study",
								screeningFields: { Relevant: true },
							},
						},
					}),
				},
			],
		},
	] as UIMessage[];
	const labels = {
		title: "Ask AI",
		user: "You",
		assistant: "GPT-5.6 Luna",
		reasoning: "Reasoning",
		smartScreening: "Smart screening",
	};

	const markdown = await chatTranscriptContent(
		"markdown",
		messages,
		labels,
		"https://example.org",
	);
	assert.ok(
		markdown.indexOf("I should search first.") <
			markdown.indexOf("Tool: Library search"),
	);
	assert.ok(
		markdown.indexOf("Tool: Library search") <
			markdown.indexOf("Final answer"),
	);
	assert.match(
		markdown,
		/\[Source, p\. 4\]\(https:\/\/example\.org\/lib\/ITEM\/download\/PDF#page=4\)/,
	);
	assert.match(markdown, /\[ITEM\]\(https:\/\/example\.org\/lib\/ITEM\)/);
	assert.match(markdown, /## Smart screening/);
	assert.match(markdown, /A useful study/);
	assert.doesNotMatch(markdown, /"screeningFields"/);

	const html = await chatTranscriptContent(
		"html",
		messages,
		labels,
		"https://example.org",
	);
	assert.doesNotMatch(html, /<script>/);
	assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	assert.doesNotMatch(html, /href="javascript:/);
	assert.match(html, /<table>/);

	const plaintext = await chatTranscriptContent(
		"plaintext",
		messages,
		labels,
		"https://example.org",
	);
	assert.match(plaintext, /Tool: Library search/);
	assert.match(plaintext, /2 results across 1 query/);
	assert.match(plaintext, /A useful study/);
});

test("per-message export includes only the final answer text", async () => {
	const message = {
		id: "assistant-1",
		role: "assistant",
		parts: [
			{
				type: "reasoning",
				text: "Secret reasoning trace",
				state: "done",
			},
			{
				type: "tool-searchLibrary",
				toolCallId: "tool-1",
				state: "output-available",
				input: { queries: ["teacher AI"] },
				output: { queries: [{ hits: [{}] }] },
			},
			{ type: "text", text: "Interim answer" },
			{
				type: "text",
				text: "**Final answer** [PAGE /lib/ITEM/download/PDF — 4 PAGE/]",
			},
		],
	} as UIMessage;

	const markdown = await chatMessageContent(
		"markdown",
		message,
		"https://example.org",
	);
	assert.doesNotMatch(markdown, /Secret reasoning/);
	assert.doesNotMatch(markdown, /Library search|Tool:|teacher AI/);
	assert.doesNotMatch(markdown, /^## /m);
	assert.match(markdown, /Interim answer/);
	assert.match(
		markdown,
		/\*\*Final answer\*\* \[Source, p\. 4\]\(https:\/\/example\.org\/lib\/ITEM\/download\/PDF#page=4\)/,
	);

	const plaintext = await chatMessageContent("plaintext", message);
	assert.match(plaintext, /^Interim answer\n\nFinal answer Source, p\. 4/);

	const html = await chatMessageContent(
		"html",
		message,
		"https://example.org",
	);
	assert.match(html, /<strong>Final answer<\/strong>/);
	assert.doesNotMatch(html, /Secret reasoning|<h2>/);
});

test("exports a page citation whose PAGE marker the model put after a label", async () => {
	// From a Girls' Education in Africa answer on Haiku 5.5. Nearby brackets and links stay as they are.
	const markdown = await chatMessageContent(
		"markdown",
		{
			id: "labelled",
			role: "assistant",
			parts: [
				{
					type: "text",
					text: "Not yet peer-reviewed. [Girl Power — PAGE /lib/DGL9WHAA/download/9RMDJSN3 — 22 PAGE/] [see table 2] [Girl Power — PAGE /lib/DGL9WHAA/download/9RMDJSN3 — 2 PAGE/](https://example.org/original)",
				},
			],
		} as UIMessage,
		"https://example.org",
	);
	assert.match(
		markdown,
		/Not yet peer-reviewed\. \[Source, p\. 22\]\(https:\/\/example\.org\/lib\/DGL9WHAA\/download\/9RMDJSN3#page=22\) \[see table 2\] \[Girl Power — PAGE \/lib\/DGL9WHAA\/download\/9RMDJSN3 — 2 PAGE\/\]\(https:\/\/example\.org\/original\)/,
	);
});
