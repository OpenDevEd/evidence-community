import { NextResponse } from "next/server";
import { streamText } from "ai";
import { trackUsage } from "@/lib/ai";
import { getRuntimeRequestLocale } from "@/i18n/server";
import { getAISystemPrompt } from "@/lib/ai-prompts";
import { prepareDocumentAIRequest } from "./document-request";

export const maxDuration = 60;

export async function POST(req: Request) {
	const { searchParams } = new URL(req.url);
	const prompt = searchParams.get("prompt") || "summarize";
	const locale = await getRuntimeRequestLocale(req);
	const { prompt: key, provider, distinctId } = await req.json();

	if (prompt !== "summarize" && prompt !== "explain") {
		return new NextResponse("Invalid prompt", { status: 400 });
	}

	const prepared = await prepareDocumentAIRequest(key, provider);
	if ("response" in prepared) return prepared.response;
	const { cleanItem, fullTextPDFs, libraryConfig, models } = prepared;

	for (const attachment of cleanItem.attachmentsData || []) {
		const fullTextPDF = fullTextPDFs?.find(
			(f: any) => f.key === attachment.key,
		)?.fullTextPDF;
		if (fullTextPDF) {
			attachment.fullTextPDF = fullTextPDF as any;
		}
	}

	const startedAt = Date.now();
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
			await trackUsage(
				libraryConfig,
				req,
				"ai_" + prompt,
				event,
				distinctId,
				Date.now() - startedAt,
			);
		},
	});

	return result.toTextStreamResponse({
		headers: {
			"Content-Type": "text/event-stream",
		},
	});
}
