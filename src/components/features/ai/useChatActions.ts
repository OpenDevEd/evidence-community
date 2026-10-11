"use client";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { UIMessage } from "ai";
import { useDisclosure } from "@nextui-org/react";
import { useLocalStorage } from "usehooks-ts";

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
import { analyticsIdField } from "@/lib/ai/chat-request";
import { createResearchRequestContextSnapshot, type ResearchRequestContextSnapshot } from "@/lib/ai/request-context";
import type { LibrarySearchContext } from "@/lib/search-context";
import { questionPublication, type AttachedItem } from "./AskAbout";
import { useIsAISearchEnabled } from "@/hooks/useAISearchMode";
import type { ChatMode, SmartScreeningField } from "@/types/ai";
import type { ResearchUIMessage } from "@/lib/ai/agent";
import {
	createTextMessage,
	researchMessageParts,
} from "@/lib/ai/chat-messages";
import type { AIModelId } from "@/lib/ai/models";
import { screeningSelection } from "@/lib/ai/screening-selection";

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
			...analyticsIdField(getAnalyticsDistinctId()),
		}),
	});
	if (!response.ok) throw new Error(await response.text());
	return (await response.json()) as Record<string, unknown>;
}

/**
 * Screens the publications named in one answer and adds the results as the
 * next message. Shared by the chat window and the chat beside the results.
 */
function useChatScreening<TMessage extends UIMessage>({
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
		async (keys: string[]) => {
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
function useScreenableContent<TMessage extends UIMessage>(
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
export function useSendWithContext({
	currentRequestContext,
	messages,
	sendMessage,
}: {
	currentRequestContext: () => ResearchRequestContextSnapshot;
	messages: ResearchUIMessage[];
	sendMessage: (message: { parts: ResearchUIMessage["parts"] }) => unknown;
}) {
	return useCallback(
		(text: string) =>
			sendMessage({
				parts: researchMessageParts(
					messages,
					currentRequestContext(),
					text,
				),
			}),
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
function useScreeningTooltip({
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
	pdfSources,
}: {
	messages: TMessage[];
	modelId: string;
	/** The PDFs the conversation read, so exported page citations link only to these. */
	pdfSources: Record<string, string>;
}) {
	const t = useTranslations("ai");
	const { ai } = useLibraryConfig();
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
					assistant: getAIModelPresentation(modelId, ai.providers).name,
					reasoning: t("reasoning"),
					smartScreening: tUI("smartScreening"),
				},
				window.location.origin,
				pdfSources,
			);
			return { content, ...CHAT_EXPORT_OUTPUT[format] };
		},
		[messages, modelId, pdfSources, t, tUI, ai.providers],
	);
}

/** Copy or download one answer. */
export function useMessageExport<TMessage extends UIMessage>(
	message: TMessage,
	pdfSources: Record<string, string>,
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
				pdfSources,
			);
			return { content: exported, ...CHAT_EXPORT_OUTPUT[format] };
		},
		[message, pdfSources],
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

/** Research mode is only offered when the library turns it on. */
export function useChatMode() {
	const { isDeepResearchEnabled } = useIsAISearchEnabled();
	const [storedMode, setMode] = useLocalStorage<ChatMode>(
		"chat-mode",
		"quick",
	);

	return {
		isDeepResearchEnabled,
		mode: isDeepResearchEnabled ? storedMode : ("quick" as ChatMode),
		setMode,
	};
}

/** Screening the answers on screen against the reader's saved fields. */
export function useScreeningControls({
	appendMessage,
	messages,
	modelId,
}: {
	appendMessage: (message: ResearchUIMessage) => void;
	messages: ResearchUIMessage[];
	modelId: AIModelId;
}) {
	const [smartScreeningFields] = useLocalStorage<SmartScreeningField[]>(
		"smart-screening-fields",
		[],
	);
	const {
		isOpen: isSmartScreeningOpen,
		onOpen: onSmartScreeningOpen,
		onOpenChange: onSmartScreeningOpenChange,
	} = useDisclosure();
	const [isMutating, setIsMutating] = useState(false);
	const [pendingScreening, setPendingScreening] =
		useState<ReturnType<typeof screeningSelection>>();
	const screenableContent = useScreenableContent(messages);
	const screen = useChatScreening({
		appendMessage,
		createMessage: (content, id) =>
			createTextMessage("assistant", content, id),
		modelId,
		setIsMutating,
		smartScreeningFields,
	});
	const handleScreening = useCallback(
		(content: string) => {
			const selection = screeningSelection(content);
			if (!selection.keys.length || smartScreeningFields.length === 0)
				return;
			if (selection.omitted > 0) {
				setPendingScreening(selection);
				return;
			}
			void screen(selection.keys);
		},
		[screen, smartScreeningFields.length],
	);

	return {
		canRunScreening:
			smartScreeningFields.length > 0 && screenableContent.length > 0,
		cancelPendingScreening: () => setPendingScreening(undefined),
		confirmPendingScreening: () => {
			if (!pendingScreening) return;
			const { keys } = pendingScreening;
			setPendingScreening(undefined);
			void screen(keys);
		},
		handleScreening,
		isMutating,
		isSmartScreeningOpen,
		onSmartScreeningOpen,
		onSmartScreeningOpenChange,
		pendingScreening,
		screenableContent,
		screeningTooltip: useScreeningTooltip({
			fieldCount: smartScreeningFields.length,
			screenableContent,
		}),
		smartScreeningFields,
	};
}

/** What the next question is about: the attached publication and the reader's search, read when it is sent. */
export function useCurrentRequestContext(attached: AttachedItem | null, searchContext?: LibrarySearchContext) {
	return useCallback(
		() =>
			createResearchRequestContextSnapshot({
				currentPublication: questionPublication(attached),
				searchContext,
			}),
		[attached, searchContext],
	);
}
