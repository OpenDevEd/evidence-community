"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { UIMessage } from "ai";

import {
	CHAT_EXPORT_OUTPUT,
	chatMessageContent,
	chatTranscriptContent,
	type ChatTranscriptFormat,
} from "@/lib/ai/transcript-export";
import type {
	ControlAction,
	GeneratedContent,
} from "@/components/features/modals/AIControls";
import { getAIModelPresentation } from "@/constants/ai";
import { clientAIError, uiMessageText } from "@/lib/ai/client";
import { AI_CONTEXT_TOO_LARGE_MESSAGE } from "@/lib/ai/error-message";
import { getAnalyticsDistinctId } from "@/lib/analytics";
import {
	latestResearchRequestContext,
	researchRequestContextPart,
	researchRequestContextsEqual,
	type ResearchRequestContextSnapshot,
} from "@/lib/ai/request-context";
import type { SmartScreeningField } from "@/types/ai";

/** The contract screens at most twenty-five publications in one request. */
const SCREENING_BATCH_LIMIT = 25;

function publicationKeysIn(content: string) {
	const keys = Array.from(
		content.matchAll(/\/lib\/([A-Za-z0-9:_-]+)/g),
		(match) => match[1],
	);
	return [...new Set(keys)].slice(0, SCREENING_BATCH_LIMIT);
}

async function screenPublications({
	fields,
	keys,
	modelId,
}: {
	fields: SmartScreeningField[];
	keys: string[];
	modelId: string;
}) {
	const response = await fetch("/api/ai/screen", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			keys,
			modelId,
			fields,
			distinctId: getAnalyticsDistinctId(),
		}),
	});
	if (!response.ok) throw new Error(await response.text());
	return (await response.json()) as Record<string, unknown>;
}

/**
 * Screens the publications named in one answer and adds the results as the
 * next message. Shared by the chat window and the chat beside the results.
 */
export function useChatScreening<TMessage extends UIMessage>({
	appendMessage,
	createMessage,
	modelId,
	setIsMutating,
	smartScreeningFields,
}: {
	appendMessage: (message: TMessage) => void;
	createMessage: (content: string, id: string) => TMessage;
	modelId: string;
	setIsMutating: (mutating: boolean) => void;
	smartScreeningFields: SmartScreeningField[];
}) {
	const tUI = useTranslations("ui");

	return useCallback(
		async (content: string) => {
			const keys = publicationKeysIn(content);
			if (!keys.length || smartScreeningFields.length === 0) return;

			setIsMutating(true);
			try {
				const result = await screenPublications({
					fields: smartScreeningFields,
					keys,
					modelId,
				});
				appendMessage(
					createMessage(
						Object.keys(result).length > 0
							? JSON.stringify({
									result,
									fields: smartScreeningFields,
								})
							: tUI("noResourcesForScreening"),
						"screening-result",
					),
				);
			} catch (failure) {
				console.error(failure);
				const readable = clientAIError(
					failure instanceof Error
						? failure
						: new Error(String(failure)),
				);
				appendMessage(
					createMessage(readable.message, "screening-error"),
				);
			} finally {
				setIsMutating(false);
			}
		},
		[
			appendMessage,
			createMessage,
			modelId,
			setIsMutating,
			smartScreeningFields,
			tUI,
		],
	);
}

/**
 * The answers a reader can screen: assistant messages that name at least one
 * publication, and are not themselves a screening result.
 */
export function useScreenableContent<TMessage extends UIMessage>(
	messages: TMessage[],
) {
	return useMemo(
		() =>
			messages
				.filter(
					(message) =>
						message.role === "assistant" &&
						!message.id.startsWith("screening-"),
				)
				.map((message) => uiMessageText(message as UIMessage))
				.filter((content) => content.includes("/lib/"))
				.join("\n"),
		[messages],
	);
}

/**
 * Sends a message, attaching the request context first whenever it changed
 * since the last one the assistant saw.
 */
export function useSendWithContext<TMessage extends UIMessage>({
	currentRequestContext,
	messages,
	sendMessage,
}: {
	currentRequestContext: () => ResearchRequestContextSnapshot;
	messages: TMessage[];
	sendMessage: (message: { parts: TMessage["parts"] }) => unknown;
}) {
	return useCallback(
		(text: string) => {
			const context = currentRequestContext();
			const parts = [] as unknown as TMessage["parts"];
			if (
				!researchRequestContextsEqual(
					latestResearchRequestContext(messages),
					context,
				)
			) {
				parts.push(researchRequestContextPart(context) as never);
			}
			parts.push({ type: "text", text } as never);
			return sendMessage({ parts });
		},
		[currentRequestContext, messages, sendMessage],
	);
}

/** Adds one message, replacing any earlier message with the same name. */
export function useAppendMessage<TMessage extends UIMessage>(
	setMessages: (updater: (messages: TMessage[]) => TMessage[]) => void,
) {
	return useCallback(
		(message: TMessage) => {
			setMessages((current) => [
				...current.filter(({ id }) => id !== message.id),
				message,
			]);
		},
		[setMessages],
	);
}

/** Why the screening button is or is not available right now. */
export function useScreeningTooltip({
	fieldCount,
	screenableContent,
}: {
	fieldCount: number;
	screenableContent: string;
}) {
	const tUI = useTranslations("ui");
	if (fieldCount === 0) return tUI("noFieldsAdded");
	if (screenableContent.length === 0) return tUI("noResourcesForScreening");
	return tUI("smartScreening");
}

/** Copy or download the whole conversation. */
export function useTranscriptExport<TMessage extends UIMessage>({
	messages,
	modelId,
}: {
	messages: TMessage[];
	modelId: string;
}) {
	const t = useTranslations("ai");
	const tUI = useTranslations("ui");

	return useCallback(
		async (action: ControlAction): Promise<GeneratedContent> => {
			if (action === "csv") {
				throw new Error("CSV is not available for chat transcripts.");
			}

			const format = action satisfies ChatTranscriptFormat;
			const content = await chatTranscriptContent(
				format,
				// The first message is the greeting, not part of the answer.
				messages.slice(1) as UIMessage[],
				{
					title: t("askAI"),
					user: tUI("genericUser"),
					assistant: getAIModelPresentation(modelId).name,
					reasoning: t("reasoning"),
					smartScreening: tUI("smartScreening"),
				},
				window.location.origin,
			);
			return { content, ...CHAT_EXPORT_OUTPUT[format] };
		},
		[messages, modelId, t, tUI],
	);
}

/** Copy or download one answer. */
export function useMessageExport<TMessage extends UIMessage>(
	message: TMessage,
) {
	return useCallback(
		async (action: ControlAction): Promise<GeneratedContent> => {
			if (action === "csv") {
				throw new Error("CSV is not available for chat messages.");
			}

			const format = action satisfies ChatTranscriptFormat;
			const exported = await chatMessageContent(
				format,
				message as UIMessage,
				window.location.origin,
			);
			return { content: exported, ...CHAT_EXPORT_OUTPUT[format] };
		},
		[message],
	);
}

/** What to tell the reader, and whether a reset is the way out. */
export function useChatFailure(error: Error | undefined) {
	const t = useTranslations("ai");
	const readable = error ? clientAIError(error) : undefined;
	const isRateLimited = Boolean(
		readable?.message.includes("RATE_LIMITED") ||
			readable?.message.includes("Rate limit exceeded"),
	);

	return {
		hasFailed: Boolean(error),
		isContextTooLarge: readable?.message === AI_CONTEXT_TOO_LARGE_MESSAGE,
		message: isRateLimited
			? t("rateLimitedMessage", { seconds: 60 })
			: readable?.message || t("errorMessage"),
	};
}
