import { NextResponse } from "next/server";
import { streamText } from 'ai';
import { trackAIUsage } from "@/lib/ai/telemetry";
import { getRuntimeRequestLocale } from "@/i18n/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import { getAISystemPrompt } from "@/lib/ai-prompts";
import { loadAIPublication } from "./publication";

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

	const publication = await loadAIPublication(libraryConfig, key, provider);
	if (!publication.ok) return publication.response;
	const { fullTextPDFs, item: cleanItem, models, startedAt } = publication;
	
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
