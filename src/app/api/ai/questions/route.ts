import { NextResponse } from "next/server";
import config from "@/constants/config.json";
import { generateObject, generateText, streamObject, streamText } from 'ai';
import { getModel, trackUsage } from "@/lib/ai";
import { routing } from "@/i18n/routing";
import { isAIAllowed } from "@/lib/utils";
import { getCachedItem } from "../../cache";
import { z } from "zod";

export const maxDuration = 60;

export async function POST(req: Request) {
    const { searchParams } = new URL(req.url);
    const locale = req.headers.get("Accept-Language") || routing.defaultLocale;
    const systemPrompt = config.prompts.questions?.join("\n")
    const sharedRules = config.shared_rules.join("\n")
    const pdfRules = config.pdf_rules.join("\n")
    const structureRules = config.structure_rules.join("\n")
    const { prompt: key, modelIndex, distinctId } = await req.json();
    const prompt = "questions"

    const item = await getCachedItem(key!);

    if (!item || !item.item) {
        return new NextResponse("Item not found", { status: 404 });
    }

    const { provider, modelName, error } = getModel(modelIndex);

    if (error) {
        return new NextResponse(error, { status: 404 });
    }

    const { fullTextPDFs, ...cleanItem } = item.item;

    if (!isAIAllowed(cleanItem)) {
        return new NextResponse("AI not allowed", { status: 403 });
    }

    if (fullTextPDFs?.length === 0) {
        return new NextResponse("No PDF attachments found", { status: 404 });
    }

    fullTextPDFs?.forEach((f: any) => {
        f.title = cleanItem.attachmentsData?.find((f: any) => f.key === f.key)?.title;
        delete f.key;
    });

    try {
        const result = await generateObject({
            model: provider!(modelName!) as any,
            system: [
                `LOCALE: ${locale}\n`,
                "You are a helpful assistant created by OpenDevEd (Open Development & Education)",
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
                    reasoningEffort: "minimal",
                },
                google: {
                    thinkingConfig: {
                        thinkingBudget: 0,
                    },
                },
            },
            prompt: JSON.stringify(fullTextPDFs)
        })

        trackUsage("ai_" + prompt, result, distinctId);

        return NextResponse.json(result.object.questions);
    } catch (error) {
        console.error(error)
        return new NextResponse("Error generating questions", { status: 500 });
    }
}
