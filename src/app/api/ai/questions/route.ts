import { NextResponse } from "next/server";
import { generateObject } from 'ai';
import { trackAIUsage } from "@/lib/ai/telemetry";
import { getRuntimeRequestLocale } from "@/i18n/server";
import { z } from "zod";
import { getLibraryConfig } from "@/config/library-config/server";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import { getAISystemPrompt } from "@/lib/ai-prompts";
import { loadAIPublication } from "../publication";

export const maxDuration = 60;

export async function POST(req: Request) {
    const libraryConfig = await getLibraryConfig();
    if (!isLibraryFeatureEnabled(libraryConfig.features, "ai")) {
        return new NextResponse("AI is disabled", { status: 403 });
    }

    const locale = await getRuntimeRequestLocale(req);
    const { prompt: key, provider, distinctId } = await req.json();
    const prompt = "questions"

	const publication = await loadAIPublication(libraryConfig, key, provider);
	if (!publication.ok) return publication.response;
	const { fullTextPDFs, item: cleanItem, models, startedAt } = publication;

    if (fullTextPDFs?.length === 0) {
        return new NextResponse("No PDF attachments found", { status: 404 });
    }

    fullTextPDFs?.forEach((f: any) => {
        f.title = cleanItem.attachmentsData?.find((f: any) => f.key === f.key)?.title;
        delete f.key;
    });

    try {
        const result = await generateObject({
            model: models.defaultModel,
            system: [
                getAISystemPrompt(libraryConfig, "questions", {
                    hasPdf: Boolean(fullTextPDFs?.length),
                    locale,
                }),
                "You are given a PDF document in the following JSON format:",
                "{ \"title\": \"PDF Title\", \"fullTextPDF\": Array<{ text: string; page: number; }> }[]",
                "You need to generate 5 questions about the PDF content.",
                "The questions should be related to the text in fullTextPDF.text",
                "The questions should be in the same language as the locale.",
            ].join("\n"),
            schema: z.object({
                questions: z.array(z.string().describe("A question to be answered by the AI regarding the PDF content"))
                    .min(5).max(5).describe("5 questions about the PDF content"),
            }),
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
            prompt: JSON.stringify(fullTextPDFs)
        })

        await trackAIUsage(libraryConfig, {
            feature: prompt,
            modelId: models.defaultModelId,
            distinctId,
            startedAt,
            success: true,
            usage: result.usage,
            providerMetadata: result.providerMetadata,
        });

        return NextResponse.json(result.object.questions);
    } catch (error) {
        console.error(error)
        return new NextResponse("Error generating questions", { status: 500 });
    }
}
