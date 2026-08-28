"use client";

import { useCallback, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useStickToBottom } from "use-stick-to-bottom";

import type { ItemGetResponse } from "@/app/api/item/types";
import { publicationPdfCitationSources } from "@/lib/ai/citations";
import { createResearchRequestContextSnapshot } from "@/lib/ai/request-context";
import { withLatestRequestContext } from "@/lib/ai/chat-messages";
import type { ResearchUIMessage } from "@/lib/ai/agent";
import type { AIModelId } from "@/lib/ai/models";
import type { LibrarySearchContext } from "@/lib/search-context";
import type { ChatMode } from "@/types/ai";
import { useScrollEdges } from "./chat-shared";
import {
	useAppendMessage,
	useChatFailure,
	useChatMode,
	useScreeningControls,
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

/** The conversation: its messages, and the ways they change. */
function useChatConversation({
	data,
	mode,
	modelId,
	onConversationStateChange,
	searchContext,
}: {
	data?: ItemGetResponse;
	mode: ChatMode;
	modelId: AIModelId;
	onConversationStateChange?: (hasConversation: boolean) => void;
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
		onConversationStateChange?.(false);
	}, [clearError, onConversationStateChange, setMessages]);

	// Retrying re-sends the last question, so it carries the context the
	// reader is looking at now rather than the one they had before.
	const reload = useCallback(() => {
		setMessages((currentMessages) =>
			withLatestRequestContext(currentMessages, currentRequestContext()),
		);

		return regenerate();
	}, [currentRequestContext, regenerate, setMessages]);

	const sendWithContext = useSendWithContext({
		currentRequestContext,
		messages,
		sendMessage,
	});
	const sendMessageWithContext = useCallback(
		(question: string) => {
			onConversationStateChange?.(true);
			return sendWithContext(question);
		},
		[onConversationStateChange, sendWithContext],
	);

	return {
		appendMessage: useAppendMessage(setMessages),
		chatFailure: useChatFailure(error),
		error,
		getTranscriptContent: useTranscriptExport({ messages, modelId }),
		isLoading: status === "submitted" || status === "streaming",
		messages,
		reload,
		resetChat,
		sendMessageWithContext,
		status,
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
	modelId,
	onConversationStateChange,
	searchContext,
}: {
	data?: ItemGetResponse;
	modelId: AIModelId;
	onConversationStateChange?: (hasConversation: boolean) => void;
	searchContext?: LibrarySearchContext;
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
		onConversationStateChange,
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

	return {
		...conversation,
		...screening,
		...composer,
		...scrolling,
		/**
		 * Asks a question that came from somewhere else on the page, such as
		 * the search field the reader opened the window from.
		 */
		ask: (question: string) => {
			const asked = question.trim();
			if (isBusy || !asked) return;
			conversation.sendMessageWithContext(asked);
		},
		conversationStarted: conversation.messages.length > 1,
		isDeepResearchEnabled,
		isWaiting: isBusy && !conversation.error,
		mode,
		pdfSources,
		prefersReducedMotion: useReducedMotion(),
		setMode,
	};
}
