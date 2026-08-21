import { getLibraryConfig } from "@/config/library-config/server";
import {
	isLibraryFeatureEnabled,
	type LibraryFeatureId,
} from "@/config/library-config/features";
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

function requestFeature(body: unknown): LibraryFeatureId {
	if (!body || typeof body !== "object") return "aiSearch";
	if (Reflect.get(body, "key")) return "ai";
	return Reflect.get(body, "mode") === "quick"
		? "aiSearch"
		: "deepResearch";
}

function invalidRequest(message = "Invalid AI request") {
	return new NextResponse(message, { status: 400 });
}

async function readRequest(req: Request) {
	try {
		return { ok: true as const, body: await req.json() };
	} catch {
		return { ok: false as const, response: invalidRequest() };
	}
}

async function publicationContext(key: string | undefined) {
	if (!key) return { item: null, fullTextPDFs: undefined };
	const result = await getCachedItem(key);
	if (!result?.item) {
		return { response: new NextResponse("Item not found", { status: 404 }) };
	}
	const { fullTextPDFs, ...item } = result.item;
	if (!isAIAllowed(item)) {
		return { response: new NextResponse("AI not allowed", { status: 403 }) };
	}
	return { item, fullTextPDFs };
}

export async function POST(req: Request) {
	const request = await readRequest(req);
	if (!request.ok) return request.response;
	const config = await getLibraryConfig();
	const requiredFeature = requestFeature(request.body);
	if (!isLibraryFeatureEnabled(config.features, requiredFeature)) {
		return new NextResponse(`${requiredFeature} is disabled`, { status: 403 });
	}

	const parsed = chatBodySchema.safeParse(request.body);
	if (!parsed.success) return invalidRequest();
	const { distinctId, key, messages, mode, provider } = parsed.data;
	if (!key && !config.search.embedder) {
		return new NextResponse("Semantic search is disabled", { status: 403 });
	}

	const context = await publicationContext(key);
	if ("response" in context) return context.response;
	const validatedMessages = await safeValidateUIMessages({ messages });
	if (!validatedMessages.success) return invalidRequest();

	let models;
	try {
		models = await getAIProviderForConfig(config, provider);
	} catch (error) {
		if (!(error instanceof AIProviderUnavailableError)) throw error;
		return new NextResponse(error.message, { status: 404 });
	}

	const locale = await getRuntimeRequestLocale(req);
	const startedAt = Date.now();
	const model = mode === "full" ? models.largeModel : models.defaultModel;
	const modelId =
		mode === "full" ? models.largeModelId : models.defaultModelId;
	const result = streamText({
		model,
		system: [
			getAISystemPrompt(config, "chat", {
				hasPdf: Boolean(context.fullTextPDFs?.length),
				locale,
			}),
			context.item
				? `Current publication: ${JSON.stringify({
					...context.item,
					fullTextPDFs: context.fullTextPDFs,
				})}`
				: "There is no current publication.",
		].join("\n"),
		messages: await convertToModelMessages(validatedMessages.data),
		async onFinish(event) {
			await trackAIUsage(config, {
				feature: "chat",
				modelId,
				distinctId,
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
