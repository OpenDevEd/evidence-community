import {
	convertToModelMessages,
	createUIMessageStreamResponse,
	safeValidateUIMessages,
	toUIMessageStream,
} from "ai";

import {
	isLibraryFeatureEnabled,
	type LibraryFeatureId,
} from "@/config/library-config/features";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { getRuntimeRequestLocale } from "@/i18n/server";
import { getAISystemPrompt } from "@/lib/ai-prompts";
import { createResearchAgent, type ResearchUIMessage } from "@/lib/ai/agent";
import {
	AIError,
	aiErrorResponse,
	aiStreamErrorMessage,
	normalizeAIError,
} from "@/lib/ai/errors";
import { resolveAIModel } from "@/lib/ai/model-resolution";
import { openRouterSessionId } from "@/lib/ai/openrouter";
import {
	createResearchRequestContextSnapshot,
	latestResearchRequestContext,
	researchRequestContextPart,
	researchRequestContextSnapshotSchema,
	researchRequestContextText,
	researchRequestContextsEqual,
	type ResearchRequestContextSnapshot,
} from "@/lib/ai/request-context";
import { chatRequestSchema } from "@/lib/ai/schemas";
import { trackAIUsage } from "@/lib/ai/telemetry";
import { getCachedItem } from "../../cache";

export const maxDuration = 240;

/**
 * Which switched-off feature would refuse this request. Read from the raw
 * body, so a library with the feature turned off answers "switched off"
 * even when the rest of the request makes no sense.
 */
function requestFeature(body: unknown): LibraryFeatureId {
	if (!body || typeof body !== "object") return "aiSearch";
	if (Reflect.get(body, "itemKey")) return "ai";
	return Reflect.get(body, "mode") === "quick" ? "aiSearch" : "deepResearch";
}

function requireFeature(
	config: Pick<LibraryServerConfig, "features">,
	body: unknown,
) {
	const feature = requestFeature(body);
	if (!isLibraryFeatureEnabled(config.features, feature)) {
		throw new AIError("AI_DISABLED", `${feature} is disabled`, 403);
	}
}

function parseChatRequest(body: unknown) {
	const parsed = chatRequestSchema.safeParse(body);
	if (!parsed.success) {
		throw new AIError("INVALID_REQUEST", "Invalid chat request.", 400);
	}
	return parsed.data;
}

/**
 * The publication the reader has open is named, not attached: the agent
 * reads its PDF through readPublications when the question needs the full
 * text, so the first reply is not held up by a download.
 */
async function currentPublication(itemKey?: string) {
	if (!itemKey) return undefined;

	const item = (await getCachedItem(itemKey))?.item;
	if (!item) {
		throw new AIError("ITEM_NOT_FOUND", "Item not found.", 404);
	}


	return { key: item.key, title: item.title || "Untitled publication" };
}

function ensureLatestRequestContext(
	messages: ResearchUIMessage[],
	expected: ResearchRequestContextSnapshot,
) {
	if (
		researchRequestContextsEqual(
			latestResearchRequestContext(messages),
			expected,
		)
	) {
		return;
	}

	const messageIndex = messages.findLastIndex(({ role }) => role === "user");
	if (messageIndex < 0) {
		throw new AIError(
			"INVALID_REQUEST",
			"A user message is required.",
			400,
		);
	}

	const message = messages[messageIndex];
	messages[messageIndex] = {
		...message,
		parts: [...message.parts, researchRequestContextPart(expected)],
	};
}

export async function POST(request: Request) {
	const startedAt = Date.now();

	try {
		const body = await request.json().catch(() => null);
		const config = await getLibraryConfig();
		requireFeature(config, body);
		const chatRequest = parseChatRequest(body);

		const { distinctId, itemKey, mode, modelId, searchContext } =
			chatRequest;
		const selectedModel = await resolveAIModel(config, modelId);
		const publication = await currentPublication(itemKey);
		const locale = await getRuntimeRequestLocale(request);

		const agent = createResearchAgent({
			config,
			mode,
			selectedModel,
			locale,
			companyName: config.identity.name,
			libraryInstructions: getAISystemPrompt(config, "chat", {
				hasPdf: Boolean(publication),
				locale,
			}),
			distinctId,
			sessionId: openRouterSessionId("chat", modelId, chatRequest.id),
			refreshResponseCache: chatRequest.trigger === "regenerate-message",
			searchContext,
			startedAt,
		});

		const validation = await safeValidateUIMessages<ResearchUIMessage>({
			messages: chatRequest.messages,
			dataSchemas: {
				requestContext: researchRequestContextSnapshotSchema,
			},
			tools: agent.tools,
		});
		if (!validation.success) {
			throw new AIError("INVALID_REQUEST", "Invalid chat messages.", 400);
		}

		ensureLatestRequestContext(
			validation.data,
			createResearchRequestContextSnapshot({
				currentPublication: publication,
				searchContext,
			}),
		);

		const result = await agent.stream({
			messages: await convertToModelMessages(validation.data, {
				tools: agent.tools,
				convertDataPart: (part) => ({
					type: "text",
					text: researchRequestContextText(
						researchRequestContextSnapshotSchema.parse(part.data),
					),
				}),
			}),
			abortSignal: request.signal,
		});

		return createUIMessageStreamResponse({
			stream: toUIMessageStream({
				stream: result.stream,
				tools: agent.tools,
				originalMessages: validation.data,
				sendReasoning: true,
				onError: (error) => {
					const normalized = normalizeAIError(error, {
						context: "conversation",
					});
					void trackAIUsage(config, {
						feature: "chat",
						modelId,
						distinctId,
						startedAt,
						success: false,
						errorCode: normalized.code,
					});
					return aiStreamErrorMessage(normalized);
				},
			}),
		});
	} catch (error) {
		return aiErrorResponse(error, { context: "conversation" });
	}
}
