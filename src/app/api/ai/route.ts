import { NextResponse } from "next/server";
import { getCachedItem } from "../cache";
import { streamText } from 'ai';
import { trackAIUsage } from "@/lib/ai/telemetry";
import { getRuntimeRequestLocale } from "@/i18n/server";
import { isAIAllowed } from "@/lib/utils";
import { getLibraryConfig } from "@/config/library-config/server";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import {
	AIProviderUnavailableError,
	getAIProviderForConfig,
} from "@/lib/ai-provider";
import { getAISystemPrompt } from "@/lib/ai-prompts";

export const maxDuration = 60;

export async function POST(req: Request) {
	const libraryConfig = await getLibraryConfig();
	if (!isLibraryFeatureEnabled(libraryConfig.features, "ai")) {
		return new NextResponse("AI is disabled", { status: 403 });
	}

	const { searchParams } = new URL(req.url);
	const prompt = searchParams.get("prompt") || "summarize";
	const locale = await getRuntimeRequestLocale(req);
	const { prompt: key, provider, distinctId } = await req.json();

	if (prompt !== "summarize" && prompt !== "explain") {
		return new NextResponse("Invalid prompt", { status: 400 });
	}

	const startedAt = Date.now();
	const item = await getCachedItem(key!);

	if (!item || !item.item) {
		return new NextResponse("Item not found", { status: 404 });
	}

	let models;
	try {
		models = await getAIProviderForConfig(
			libraryConfig,
			provider,
		);
	} catch (error) {
		if (error instanceof AIProviderUnavailableError) {
			return new NextResponse(error.message, { status: 404 });
		}
		throw error;
	}

	const {fullTextPDFs, ...cleanItem} = item.item;

	if (!isAIAllowed(cleanItem)) {
		return new NextResponse("AI not allowed", { status: 403 });
	}
	
	for (const attachment of cleanItem.attachmentsData || []) {
		const fullTextPDF = fullTextPDFs?.find((f: any) => f.key === attachment.key)?.fullTextPDF
		if (fullTextPDF) {
			attachment.fullTextPDF = fullTextPDF as any;
		}
	}

	const result = streamText({
		model: models.defaultModel,
		system: getAISystemPrompt(libraryConfig, prompt, {
			hasPdf: Boolean(fullTextPDFs?.length),
			locale,
		}),
		prompt: JSON.stringify(cleanItem),
		temperature: 1,
		providerOptions: {
			openai: {
				reasoningEffort: "low",
			},
			google: {
				thinkingConfig: {
					thinkingBudget: 0,
				},
			},
		},
		async onFinish(event) {
			await trackAIUsage(libraryConfig, {
				feature: prompt,
				modelId: models.defaultModelId,
				distinctId,
				startedAt,
				success: true,
				usage: event.usage,
				providerMetadata: event.providerMetadata,
			});
		},
	})

	return result.toTextStreamResponse({
		headers: {
			'Content-Type': 'text/event-stream',
		},
	})

}
