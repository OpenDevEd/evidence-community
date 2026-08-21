import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { getAISystemPrompt } from "@/lib/ai-prompts";
import { trackAIUsage } from "@/lib/ai/telemetry";
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Item } from "../../item/types";
import {
	loadAIPublication,
	loadAIPublicationRequest,
} from "../publication";

export const maxDuration = 60;

const questionsSchema = z.object({
	questions: z
		.array(z.string().describe("A question about the PDF content"))
		.length(5)
		.describe("Five questions about the PDF content"),
});

function hasFullTextPDFs(
	value: Item["fullTextPDFs"],
): value is NonNullable<Item["fullTextPDFs"]> {
	return Array.isArray(value) && value.length > 0;
}

function questionDocuments(
	fullTextPDFs: NonNullable<Item["fullTextPDFs"]>,
	attachments: Item["attachmentsData"],
) {
	return fullTextPDFs.map(({ key, ...document }) => ({
		...document,
		title: attachments?.find((attachment) => attachment.key === key)?.title,
	}));
}

async function generateQuestions(
	config: LibraryServerConfig,
	locale: string,
	publication: Awaited<ReturnType<typeof loadAIPublication>> & { ok: true },
	fullTextPDFs: NonNullable<Item["fullTextPDFs"]>,
	distinctId: string | null | undefined,
) {
	const { item, models, startedAt } = publication;
	const documents = questionDocuments(
		fullTextPDFs,
		item.attachmentsData,
	);
	try {
		const result = await generateObject({
			model: models.defaultModel,
			system: [
				getAISystemPrompt(config, "questions", { hasPdf: true, locale }),
				"You are given PDF documents as JSON objects with a title and fullTextPDF pages.",
				"Generate five questions about the text in the same language as the locale.",
			].join("\n"),
			schema: questionsSchema,
			temperature: 1,
			providerOptions: {
				openai: { reasoningEffort: "low" },
				google: { thinkingConfig: { thinkingBudget: 0 } },
			},
			prompt: JSON.stringify(documents),
		});

		await trackAIUsage(config, {
			feature: "questions",
			modelId: models.defaultModelId,
			distinctId,
			startedAt,
			success: true,
			usage: result.usage,
			providerMetadata: result.providerMetadata,
		});
		return NextResponse.json(result.object.questions);
	} catch (error) {
		console.error(error);
		return new NextResponse("Error generating questions", { status: 500 });
	}
}

export async function POST(req: Request) {
	const config = await getLibraryConfig();
	if (!isLibraryFeatureEnabled(config.features, "ai")) {
		return new NextResponse("AI is disabled", { status: 403 });
	}
	const { distinctId, locale, publication } =
		await loadAIPublicationRequest(config, req);
	if (!publication.ok) return publication.response;
	if (!hasFullTextPDFs(publication.fullTextPDFs)) {
		return new NextResponse("No PDF attachments found", { status: 404 });
	}
	return generateQuestions(
		config,
		locale,
		publication,
		publication.fullTextPDFs,
		distinctId,
	);
}
