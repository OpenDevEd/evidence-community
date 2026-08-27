import { routing } from "@/i18n/routing";
import {
	createResearchAgent,
	type ResearchUIMessage,
} from "@/lib/ai/agent";
import { getCachedItem, getCachedStatus } from "@/app/api/cache";
import { isVisiblePdfAttachment } from "@/lib/attachment-visibility";
import { parseCompanyName } from "@/lib/utils";
import {
	AIError,
	aiErrorResponse,
	aiStreamErrorMessage,
	normalizeAIError,
} from "@/lib/ai/errors";
import { chatRequestSchema } from "@/lib/ai/schemas";
import { createOpenRouterSessionId } from "@/lib/ai/openrouter-cache";
import { isOpenRouterConfigured } from "@/lib/ai/provider";
import {
	createResearchRequestContextSnapshot,
	latestResearchRequestContext,
	researchRequestContextsEqual,
	researchRequestContextPart,
	researchRequestContextSnapshotSchema,
	researchRequestContextText,
	type ResearchRequestContextSnapshot,
} from "@/lib/ai/request-context";
import { trackAIUsage } from "@/lib/ai/telemetry";
import { getServerAnalyticsContext } from "@/lib/server-analytics";
import { convertToModelMessages, safeValidateUIMessages } from "ai";

export const maxDuration = 240;

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
		parts: [
			...message.parts,
			researchRequestContextPart(expected),
		],
	};
}

export async function POST(request: Request) {
	const startedAt = Date.now();

	try {
		const body = chatRequestSchema.safeParse(await request.json());
		if (!body.success) {
			throw new AIError("INVALID_REQUEST", "Invalid chat request.", 400);
		}

		const { modelId, distinctId, mode, itemKey, searchContext } = body.data;
		const analyticsContext = getServerAnalyticsContext(request, distinctId);
		if (!isOpenRouterConfigured()) {
			throw new AIError(
				"AI_DISABLED",
				"AI features are not configured.",
				503,
			);
		}
		const locale =
			request.headers.get("Accept-Language") || routing.defaultLocale;
		const sessionId = createOpenRouterSessionId(
			"chat",
			modelId,
			body.data.id,
		);
		// The current publication is referenced, not attached: the agent reads
		// its PDF on demand through readPublications, which keeps the first
		// reply fast and makes the read visible as a tool call.
		const item = itemKey ? (await getCachedItem(itemKey))?.item : null;
		if (itemKey && !item) {
			throw new AIError("ITEM_NOT_FOUND", "Item not found.", 404);
		}
		if (item && !(item.attachmentsData ?? []).some(isVisiblePdfAttachment)) {
			throw new AIError(
				"INVALID_REQUEST",
				"This publication has no visible PDF attachments.",
				403,
			);
		}
		const publication = item
			? { key: item.key, title: item.title || "Untitled publication" }
			: null;

		const { companyName } = parseCompanyName(
			(await getCachedStatus()).companyName,
		);
		const agent = createResearchAgent({
			mode,
			modelId,
			companyName,
			locale,
			analyticsContext,
			sessionId,
			refreshResponseCache: body.data.trigger === "regenerate-message",
			startedAt,
			searchContext,
		});
		const validation = await safeValidateUIMessages<ResearchUIMessage>({
			messages: body.data.messages,
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
				currentPublication: publication
					? { key: publication.key, title: publication.title }
					: undefined,
				searchContext,
			}),
		);
		const modelMessages = await convertToModelMessages(validation.data, {
			tools: agent.tools,
			convertDataPart: (part) => ({
				type: "text",
				text: researchRequestContextText(
					researchRequestContextSnapshotSchema.parse(part.data),
				),
			}),
		});
		const overflowContext = "conversation" as const;

		const result = await agent.stream({
			messages: modelMessages,
			abortSignal: request.signal,
		});

		return result.toUIMessageStreamResponse({
			originalMessages: validation.data,
			sendReasoning: true,
			onError: (error) => {
				const normalized = normalizeAIError(error, {
					context: overflowContext,
				});
				trackAIUsage({
					analyticsContext,
					feature:
						mode === "research" ? "deep_research" : "quick_chat",
					modelId,
					startedAt,
					success: false,
					errorCode: normalized.code,
				});
				return aiStreamErrorMessage(normalized);
			},
		});
	} catch (error) {
		return aiErrorResponse(error, { context: "conversation" });
	}
}
