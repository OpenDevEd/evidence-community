import { streamText } from "ai";

import { getRuntimeRequestLocale } from "@/i18n/server";
import { getAISystemPrompt } from "@/lib/ai-prompts";
import { publicationPromptParts } from "@/lib/ai/attachments";
import { aiErrorResponse } from "@/lib/ai/errors";
import { publicationGenerationSchema } from "@/lib/ai/schemas";
import { trackAIUsage } from "@/lib/ai/telemetry";
import { loadSelectedPublication, readAIRequest } from "./publication";

export const maxDuration = 60;

const FEATURE_INSTRUCTIONS = {
	summarize: "Summarize this publication.",
	explain: "Explain this publication.",
} as const;

export async function POST(request: Request) {
	const startedAt = Date.now();

	try {
		const { config, request: parsed } = await readAIRequest(
			request,
			publicationGenerationSchema,
		);
		const { distinctId, feature, modelId, prompt: itemKey } = parsed;
		const { publication, selectedModel } = await loadSelectedPublication(
			config,
			{ itemKey, modelId },
		);
		const locale = await getRuntimeRequestLocale(request);

		const result = streamText({
			model: selectedModel.model,
			system: getAISystemPrompt(config, feature, {
				hasPdf: publication.files.length > 0,
				locale,
			}),
			messages: [
				{
					role: "user",
					content: publicationPromptParts(
						publication,
						FEATURE_INSTRUCTIONS[feature],
						selectedModel.provider,
						selectedModel.modelId,
					),
				},
			],
			async onFinish(event) {
				await trackAIUsage(config, {
					feature,
					modelId: selectedModel.modelId,
					distinctId,
					startedAt,
					success: true,
					usage: event.usage,
					providerMetadata: event.providerMetadata,
				});
			},
		});

		return result.toTextStreamResponse({
			headers: { "Content-Type": "text/event-stream" },
		});
	} catch (error) {
		return aiErrorResponse(error, { context: "document" });
	}
}
