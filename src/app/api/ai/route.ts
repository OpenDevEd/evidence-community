import config from "@/constants/config.json";
import { routing } from "@/i18n/routing";
import {
	AIError,
	aiErrorResponse,
	aiStreamErrorMessage,
	normalizeAIError,
} from "@/lib/ai/errors";
import { loadPublication, publicationPromptParts } from "@/lib/ai/attachments";
import { getCachedStatus } from "@/app/api/cache";
import { parseCompanyName } from "@/lib/utils";
import {
	createOpenRouterSessionId,
	openRouterResponseCacheHeaders,
	OPENROUTER_RESPONSE_CACHE_TTL,
} from "@/lib/ai/openrouter-cache";
import { getOpenRouterModel } from "@/lib/ai/provider";
import { publicationGenerationSchema } from "@/lib/ai/schemas";
import { trackAIUsage } from "@/lib/ai/telemetry";
import { getServerAnalyticsContext } from "@/lib/server-analytics";
import {
	EVIDENCE_CITATION_INSTRUCTIONS,
	currentDateContext,
	publicationSystemContext,
} from "@/lib/ai/prompt-context";
import { answerLanguageInstruction } from "@/lib/ai/answer-language";
import { streamText } from "ai";

export const maxDuration = 240;

export async function POST(request: Request) {
	const startedAt = Date.now();

	try {
		const body = publicationGenerationSchema.safeParse(
			await request.json(),
		);
		if (!body.success) {
			throw new AIError("INVALID_REQUEST", "Invalid AI request.", 400);
		}

		const { prompt: itemKey, feature, modelId, distinctId } = body.data;
		const analyticsContext = getServerAnalyticsContext(request, distinctId);
		const publication = await loadPublication(itemKey);
		if (!publication) {
			throw new AIError("ITEM_NOT_FOUND", "Item not found.", 404);
		}
		if (publication.files.length + publication.unavailable.length === 0) {
			throw new AIError(
				"INVALID_REQUEST",
				"This publication has no visible PDF attachments.",
				403,
			);
		}

		const locale =
			request.headers.get("Accept-Language") || routing.defaultLocale;
		const sessionId = createOpenRouterSessionId(
			"publication",
			modelId,
			locale,
			itemKey,
		);
		const model = getOpenRouterModel(modelId, { sessionId });
		const featurePrompt = config.prompts[feature].join("\n");
		const result = streamText({
			model,
			system: publicationSystemContext(
				locale,
				parseCompanyName((await getCachedStatus()).companyName)
					.companyName,
			),
			messages: [
				{
					role: "user",
					content: publicationPromptParts(
						publication,
						[
							currentDateContext(),
							featurePrompt,
							feature === "summarize"
								? "Summarize this publication."
								: "Explain this publication in detail.",
							EVIDENCE_CITATION_INSTRUCTIONS,
							"If no full PDF is available, clearly state that the full text was unavailable.",
							// Last, after the publication: a long PDF in another language otherwise wins.
							answerLanguageInstruction(locale),
						].join("\n"),
						modelId,
					),
				},
			],
			headers: openRouterResponseCacheHeaders(
				OPENROUTER_RESPONSE_CACHE_TTL.publication,
			),
				onFinish: ({ usage, providerMetadata, response }) => {
				trackAIUsage({
					analyticsContext,
					feature,
					modelId,
					startedAt,
					success: true,
					usage,
					providerMetadata,
					responseHeaders: response.headers,
				});
			},
			onError: ({ error }) => {
				const normalized = normalizeAIError(error, {
					context: "document",
				});
				trackAIUsage({
					analyticsContext,
					feature,
					modelId,
					startedAt,
					success: false,
					errorCode: normalized.code,
				});
			},
		});

		return result.toUIMessageStreamResponse({
			sendReasoning: false,
			onError: (error) =>
				aiStreamErrorMessage(error, { context: "document" }),
		});
	} catch (error) {
		return aiErrorResponse(error, { context: "document" });
	}
}
