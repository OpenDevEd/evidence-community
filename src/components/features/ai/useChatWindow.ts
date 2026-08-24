"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useDisclosure } from "@nextui-org/react";
import { useLocalStorage } from "usehooks-ts";
import { useStickToBottom } from "use-stick-to-bottom";

import type { ItemGetResponse } from "@/app/api/item/types";
import { publicationPdfCitationSources } from "@/lib/ai/citations";
import { createResearchRequestContextSnapshot } from "@/lib/ai/request-context";
import {
	createTextMessage,
	withLatestRequestContext,
} from "@/lib/ai/chat-messages";
import type { ResearchUIMessage } from "@/lib/ai/agent";
import type { AIModelId } from "@/lib/ai/models";
import type { LibrarySearchContext } from "@/lib/search-context";
import { useIsAISearchEnabled } from "@/hooks/useAISearchMode";
import type { ChatMode, SmartScreeningField } from "@/types/ai";
import { useScrollEdges } from "./chat-shared";
import {
	useAppendMessage,
	useChatFailure,
	useChatScreening,
	useScreenableContent,
	useScreeningTooltip,
	useSendWithContext,
	useTranscriptExport,
} from "./useChatActions";
import { useChatGreeting, useChatWindowSession } from "./useChatWindowSession";

/** Keeps the newest message in view, and fades the edges while scrolling. */
function useChatScrolling() {
	const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
		useStickToBottom({ initial: "smooth", resize: "smooth" });
	const { edges: scrollEdges, ref: scrollEdgesRef } = useScrollEdges();
	const messagesScrollRef = useCallback(
		(element: HTMLDivElement | null) => {
			scrollRef(element);
			scrollEdgesRef(element);
		},
		[scrollRef, scrollEdgesRef],
	);

	return {
		contentRef,
		isAtBottom,
		messagesScrollRef,
		scrollEdges,
		scrollToBottom,
	};
}

/** A question typed elsewhere on the page is asked once the window opens. */
function useExternalQuestion({
	externalInput,
	isReady,
	onAsk,
	setExternalInput,
}: {
	externalInput?: string;
	isReady: boolean;
	onAsk: (question: string) => void;
	setExternalInput?: (input: string) => void;
}) {
	useEffect(() => {
		if (!externalInput || !isReady) return;
		onAsk(externalInput);
		setExternalInput?.("");
	}, [externalInput, isReady, onAsk, setExternalInput]);
}

/** Research mode is only offered when the library turns it on. */
function useChatMode() {
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

/** The conversation: its messages, and the ways they change. */
function useChatConversation({
	data,
	mode,
	modelId,
	searchContext,
}: {
	data?: ItemGetResponse;
	mode: ChatMode;
	modelId: AIModelId;
	searchContext?: LibrarySearchContext;
}) {
	const publicationKey = data?.item?.key;
	const publicationTitle = data?.item?.title;
	const {
		messages,
		sendMessage,
		error,
		status,
		regenerate,
		setMessages,
		clearError,
	} = useChatWindowSession({
		greeting: useChatGreeting(publicationTitle ?? undefined),
		itemKey: publicationKey,
		mode,
		modelId,
		searchContext,
	});

	const currentRequestContext = useCallback(
		() =>
			createResearchRequestContextSnapshot({
				currentPublication: publicationKey
					? {
							key: publicationKey,
							title: publicationTitle || "Untitled publication",
						}
					: undefined,
				searchContext,
			}),
		[publicationKey, publicationTitle, searchContext],
	);

	const resetChat = useCallback(() => {
		clearError();
		setMessages((currentMessages) => currentMessages.slice(0, 1));
	}, [clearError, setMessages]);

	// Retrying re-sends the last question, so it carries the context the
	// reader is looking at now rather than the one they had before.
	const reload = useCallback(() => {
		setMessages((currentMessages) =>
			withLatestRequestContext(currentMessages, currentRequestContext()),
		);

		return regenerate();
	}, [currentRequestContext, regenerate, setMessages]);

	return {
		appendMessage: useAppendMessage(setMessages),
		chatFailure: useChatFailure(error),
		error,
		getTranscriptContent: useTranscriptExport({ messages, modelId }),
		isLoading: status === "submitted" || status === "streaming",
		messages,
		reload,
		resetChat,
		sendMessageWithContext: useSendWithContext({
			currentRequestContext,
			messages,
			sendMessage,
		}),
		status,
	};
}

/** Screening the answers on screen against the reader's saved fields. */
function useScreeningControls({
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
	const screenableContent = useScreenableContent(messages);

	return {
		canRunScreening:
			smartScreeningFields.length > 0 && screenableContent.length > 0,
		handleScreening: useChatScreening({
			appendMessage,
			createMessage: (content, id) =>
				createTextMessage("assistant", content, id),
			modelId,
			setIsMutating,
			smartScreeningFields,
		}),
		isMutating,
		isSmartScreeningOpen,
		onSmartScreeningOpen,
		onSmartScreeningOpenChange,
		screenableContent,
		screeningTooltip: useScreeningTooltip({
			fieldCount: smartScreeningFields.length,
			screenableContent,
		}),
		smartScreeningFields,
	};
}

/** What the reader has typed, and what happens when they send it. */
function useChatComposer({
	isBusy,
	onSend,
}: {
	isBusy: boolean;
	onSend: (question: string) => void;
}) {
	const [input, setInput] = useState("");
	const [isComposerFocused, setIsComposerFocused] = useState(false);
	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		// Ignore submits while a response is generating; the input keeps its
		// text so nothing is lost.
		if (isBusy || !input.trim()) return;
		onSend(input);
		setInput("");
	};

	return {
		handleSubmit,
		input,
		isComposerFocused,
		isInputReady: input.trim().length > 0 && !isBusy,
		setInput,
		setIsComposerFocused,
	};
}

/**
 * Everything one chat window needs: its conversation, what the reader has
 * typed, how far they have scrolled, and the actions they can take.
 */
export function useChatWindow({
	data,
	externalInput,
	isOpen,
	modelId,
	searchContext,
	setExternalInput,
}: {
	data?: ItemGetResponse;
	externalInput?: string;
	isOpen: boolean;
	modelId: AIModelId;
	searchContext?: LibrarySearchContext;
	setExternalInput?: (input: string) => void;
}) {
	const publicationKey = data?.item?.key;
	const attachmentsData = data?.item?.attachmentsData;
	const pdfSources = useMemo(
		() => publicationPdfCitationSources(publicationKey, attachmentsData),
		[publicationKey, attachmentsData],
	);
	const { isDeepResearchEnabled, mode, setMode } = useChatMode();
	const conversation = useChatConversation({
		data,
		mode,
		modelId,
		searchContext,
	});
	const screening = useScreeningControls({
		appendMessage: conversation.appendMessage,
		messages: conversation.messages,
		modelId,
	});
	const isBusy = conversation.isLoading || screening.isMutating;
	const composer = useChatComposer({
		isBusy,
		onSend: conversation.sendMessageWithContext,
	});
	const scrolling = useChatScrolling();

	useExternalQuestion({
		externalInput,
		isReady: isOpen && !isBusy,
		onAsk: conversation.sendMessageWithContext,
		setExternalInput,
	});

	return {
		...conversation,
		...screening,
		...composer,
		...scrolling,
		conversationStarted: conversation.messages.length > 1,
		isDeepResearchEnabled,
		isWaiting: isBusy && !conversation.error,
		mode,
		pdfSources,
		prefersReducedMotion: useReducedMotion(),
		setMode,
	};
}
