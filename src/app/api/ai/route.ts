import {
	createUIMessageStreamResponse,
	streamText,
	toUIMessageStream,
} from "ai";

import { getRuntimeRequestLocale } from "@/i18n/server";
import { getAISystemPrompt } from "@/lib/ai-prompts";
import { publicationPromptParts } from "@/lib/ai/attachments";
import {
	aiErrorResponse,
	aiStreamErrorMessage,
	normalizeAIError,
} from "@/lib/ai/errors";
import {
	OPENROUTER_RESPONSE_CACHE_TTL,
	openRouterModelSettings,
	openRouterResponseCacheHeaders,
	openRouterSessionId,
} from "@/lib/ai/openrouter";
import {
	currentDateContext,
	EVIDENCE_CITATION_INSTRUCTIONS,
} from "@/lib/ai/prompt-context";
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
		const model = selectedModel.createModel(
			selectedModel.modelId,
			openRouterModelSettings(
				selectedModel.provider,
				selectedModel.modelId,
				{
					sessionId: openRouterSessionId(
						"publication",
						selectedModel.modelId,
						locale,
						itemKey,
					),
				},
			),
		);

		const result = streamText({
			model,
			system: [
				getAISystemPrompt(config, feature, {
					hasPdf: publication.files.length > 0,
					locale,
				}),
				currentDateContext(),
				EVIDENCE_CITATION_INSTRUCTIONS,
			].join("\n"),
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
			...(selectedModel.provider === "openrouter"
				? {
						headers: openRouterResponseCacheHeaders(
							OPENROUTER_RESPONSE_CACHE_TTL.publication,
						),
					}
				: {}),
			async onFinish(event) {
				await trackAIUsage(config, {
					feature,
					modelId: selectedModel.modelId,
					distinctId,
					startedAt,
					success: true,
					usage: event.usage,
					providerMetadata: event.providerMetadata,
					responseHeaders: event.response.headers,
				});
			},
			onError({ error }) {
				const normalized = normalizeAIError(error, {
					context: "document",
				});
				void trackAIUsage(config, {
					feature,
					modelId: selectedModel.modelId,
					distinctId,
					startedAt,
					success: false,
					errorCode: normalized.code,
				});
			},
		});

		return createUIMessageStreamResponse({
			stream: toUIMessageStream({
				stream: result.stream,
				sendReasoning: false,
				onError: (error) =>
					aiStreamErrorMessage(error, { context: "document" }),
			}),
		});
	} catch (error) {
		return aiErrorResponse(error, { context: "document" });
	}
}
