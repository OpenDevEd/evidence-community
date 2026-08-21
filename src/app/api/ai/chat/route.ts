import {
	isLibraryFeatureEnabled,
	type LibraryFeatureId,
} from "@/config/library-config/features";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { getRuntimeRequestLocale } from "@/i18n/server";
import {
	AIProviderUnavailableError,
	getAIProviderForConfig,
} from "@/lib/ai-provider";
import { aiStreamErrorMessage } from "@/lib/ai/errors";
import { trackAIUsage } from "@/lib/ai/telemetry";
import { getAISystemPrompt } from "@/lib/ai-prompts";
import { isAIAllowed } from "@/lib/utils";
import {
	convertToModelMessages,
	safeValidateUIMessages,
	streamText,
} from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCachedItem } from "../../cache";

export const maxDuration = 240;

const chatBodySchema = z
	.object({
		distinctId: z.string().trim().min(1).max(200).nullish(),
		id: z.string().trim().min(1).max(200),
		key: z.string().trim().min(1).max(255).optional(),
		messageId: z.string().trim().min(1).max(200).optional(),
		messages: z.array(z.unknown()).min(1).max(100),
		mode: z.enum(["quick", "full"]),
		provider: z.string().trim().min(1).max(50),
		trigger: z.enum(["submit-message", "regenerate-message"]),
	})
	.strict();

type ChatBody = z.infer<typeof chatBodySchema>;
type ResolvedModels = Awaited<ReturnType<typeof getAIProviderForConfig>>;

class AIRequestError extends Error {
	readonly response: NextResponse;

	constructor(message: string, status: number) {
		super(message);
		this.response = new NextResponse(message, { status });
	}
}

function failRequest(message: string, status: number): never {
	throw new AIRequestError(message, status);
}

function isObject(value: unknown): value is object {
	if (!value) return false;
	return typeof value === "object";
}

async function requestBody(req: Request) {
	try {
		return await req.json();
	} catch {
		return failRequest("Invalid AI request", 400);
	}
}

function requestFeature(body: unknown): LibraryFeatureId {
	if (!isObject(body)) return "aiSearch";
	if (Reflect.get(body, "key")) return "ai";
	if (Reflect.get(body, "mode") === "quick") return "aiSearch";
	return "deepResearch";
}

function requireFeature(config: LibraryServerConfig, body: unknown) {
	const feature = requestFeature(body);
	if (!isLibraryFeatureEnabled(config.features, feature)) {
		failRequest(`${feature} is disabled`, 403);
	}
}

function parseChatBody(body: unknown): ChatBody {
	const parsed = chatBodySchema.safeParse(body);
	if (!parsed.success) return failRequest("Invalid AI request", 400);
	return parsed.data;
}

function requireSemanticSearch(config: LibraryServerConfig, key?: string) {
	if (!key && !config.search.embedder) {
		failRequest("Semantic search is disabled", 403);
	}
}

async function publicationContext(key?: string) {
	if (!key) return { item: null, fullTextPDFs: undefined };
	const cachedItem = await requireCachedItem(key);
	const { fullTextPDFs, ...item } = cachedItem;
	if (!isAIAllowed(item)) return failRequest("AI not allowed", 403);
	return { item, fullTextPDFs };
}

async function requireCachedItem(key: string) {
	const result = await getCachedItem(key);
	if (!result || !result.item) return failRequest("Item not found", 404);
	return result.item;
}

async function validatedMessages(messages: ChatBody["messages"]) {
	const result = await safeValidateUIMessages({ messages });
	if (!result.success) return failRequest("Invalid AI request", 400);
	return result.data;
}

async function resolvedModels(
	config: LibraryServerConfig,
	provider: string,
) {
	try {
		return await getAIProviderForConfig(config, provider);
	} catch (error) {
		if (error instanceof AIProviderUnavailableError) {
			return failRequest(error.message, 404);
		}
		throw error;
	}
}

function selectedModel(mode: ChatBody["mode"], models: ResolvedModels) {
	if (mode === "full") {
		return { model: models.largeModel, modelId: models.largeModelId };
	}
	return { model: models.defaultModel, modelId: models.defaultModelId };
}

function publicationPrompt(context: Awaited<ReturnType<typeof publicationContext>>) {
	if (!context.item) return "There is no current publication.";
	return `Current publication: ${JSON.stringify({
		...context.item,
		fullTextPDFs: context.fullTextPDFs,
	})}`;
}

async function createChatResponse(req: Request) {
	const body = await requestBody(req);
	const config = await getLibraryConfig();
	requireFeature(config, body);
	const data = parseChatBody(body);
	requireSemanticSearch(config, data.key);
	const context = await publicationContext(data.key);
	const messages = await validatedMessages(data.messages);
	const models = await resolvedModels(config, data.provider);
	const { model, modelId } = selectedModel(data.mode, models);
	const locale = await getRuntimeRequestLocale(req);
	const startedAt = Date.now();
	const result = streamText({
		model,
		system: [
			getAISystemPrompt(config, "chat", {
				hasPdf: Boolean(context.fullTextPDFs?.length),
				locale,
			}),
			publicationPrompt(context),
		].join("\n"),
		messages: await convertToModelMessages(messages),
		async onFinish(event) {
			await trackAIUsage(config, {
				feature: "chat",
				modelId,
				distinctId: data.distinctId,
				startedAt,
				success: true,
				usage: event.usage,
				providerMetadata: event.providerMetadata,
			});
		},
	});
	return result.toUIMessageStreamResponse({
		onError: (error) => aiStreamErrorMessage(error, { context: "conversation" }),
	});
}

export async function POST(req: Request) {
	try {
		return await createChatResponse(req);
	} catch (error) {
		if (error instanceof AIRequestError) return error.response;
		throw error;
	}
}
