import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { trackUsage } from "@/lib/ai";
import { getRuntimeRequestLocale } from "@/i18n/server";
import { z } from "zod";
import { getAISystemPrompt } from "@/lib/ai-prompts";
import { prepareDocumentAIRequest } from "../document-request";

export const maxDuration = 60;

export async function POST(req: Request) {
	const locale = await getRuntimeRequestLocale(req);
	const { prompt: key, provider, distinctId } = await req.json();
	const prompt = "questions";

	const prepared = await prepareDocumentAIRequest(key, provider);
	if ("response" in prepared) return prepared.response;
	const { cleanItem, fullTextPDFs, libraryConfig, models } = prepared;

	if (!fullTextPDFs?.length) {
		return new NextResponse("No PDF attachments found", { status: 404 });
	}

	fullTextPDFs?.forEach((f: any) => {
		f.title = cleanItem.attachmentsData?.find(
			(f: any) => f.key === f.key,
		)?.title;
		delete f.key;
	});

	try {
		const startedAt = Date.now();
		const result = await generateObject({
			model: models.defaultModel,
			system: [
				getAISystemPrompt(libraryConfig, "questions", {
					hasPdf: Boolean(fullTextPDFs?.length),
					locale,
				}),
				"You are given a PDF document in the following JSON format:",
				'{ "title": "PDF Title", "fullTextPDF": Array<{ text: string; page: number; }> }[]',
				"You need to generate 5 questions about the PDF content.",
				"The questions should be related to the text in fullTextPDF.text",
				"The questions should be in the same language as the locale.",
			].join("\n"),
			schema: z.object({
				questions: z
					.array(
						z
							.string()
							.describe(
								"A question to be answered by the AI regarding the PDF content",
							),
					)
					.min(5)
					.max(5)
					.describe("5 questions about the PDF content"),
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
			prompt: JSON.stringify(fullTextPDFs),
		});

		await trackUsage(
			libraryConfig,
			req,
			"ai_" + prompt,
			result,
			distinctId,
			Date.now() - startedAt,
		);

		return NextResponse.json(result.object.questions);
	} catch (error) {
		console.error(error);
		return new NextResponse("Error generating questions", { status: 500 });
	}
}
