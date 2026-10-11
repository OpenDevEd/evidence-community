"use client";

import { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useStickToBottom } from "use-stick-to-bottom";

import {
	useInlineChatDraft,
	useInlineChatLayout,
} from "@/context/InlineChatLayout";
import { bucketEntriesFromMessages } from "@/lib/ai/context-bucket";
import { isAnswering } from "@/lib/ai/chat-request";
import { createResearchRequestContextSnapshot } from "@/lib/ai/request-context";
import type { AIModelId } from "@/lib/ai/models";
import type { ChatMode } from "@/types/ai";
import type { LibrarySearchContext } from "@/lib/search-context";
import { useScrollEdges } from "./chat-shared";
import { useBucketPublications } from "./ContextBucket";
import {
	useAppendMessage,
	useChatFailure,
	useChatMode,
	useScreeningControls,
	useSendWithContext,
	useTranscriptExport,
} from "./useChatActions";
import { useComposerDock } from "./useComposerDock";
import { useInlineChatSession } from "./useInlineChatSession";

/** True when Esc should close the chat rather than something on top of it. */
function closesTheChat(event: KeyboardEvent) {
	if (event.key !== "Escape") return false;
	if (event.defaultPrevented || event.isComposing) return false;

	// Dialogs and open menus own Escape before the conversation does.
	return !document.querySelector(
		'[role="dialog"], [role="menu"], [role="listbox"]',
	);
}

/** Esc closes the chat, unless a dialog on top of it wants the key. */
function useEscapeToClose(closeChat: () => void) {
	// Outside system: the browser's keyboard, which has no React event here
	// because Esc must work wherever the reader is on the page.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!closesTheChat(event)) return;
			event.preventDefault();
			closeChat();
		};

		// React Aria buttons stop key events from bubbling to the document.
		document.addEventListener("keydown", onKeyDown, true);

		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [closeChat]);
}

/** The conversation itself, and the ways it changes. */
function useInlineConversation({
	mode,
	modelId,
	searchContext,
}: {
	mode: ChatMode;
	modelId: AIModelId;
	searchContext?: LibrarySearchContext;
}) {
	const t = useTranslations("ai");
	const { attached } = useInlineChatDraft();
	const {
		chat,
		messages,
		sendMessage,
		error,
		status,
		regenerate,
		setMessages,
		clearError,
	} = useInlineChatSession({
		greeting: t("askMeAnythingPublications"),
		itemKey: attached?.key,
		mode,
		modelId,
		searchContext,
	});
	const currentRequestContext = useCallback(
		() =>
			createResearchRequestContextSnapshot({
				currentPublication: attached ?? undefined,
				searchContext,
			}),
		[attached, searchContext],
	);
	const resetChat = useCallback(() => {
		clearError();
		setMessages((current) => current.slice(0, 1));
	}, [clearError, setMessages]);

	return {
		appendMessage: useAppendMessage(setMessages),
		// What the assistant has used is read out of the conversation itself,
		// so it is right again after leaving the page and coming back.
		bucketEntries: bucketEntriesFromMessages(messages),
		chat,
		chatFailure: useChatFailure(error),
		error,
		getTranscriptContent: useTranscriptExport({ messages, modelId }),
		isLoading: status === "submitted" || status === "streaming",
		messages,
		reload: regenerate,
		resetChat,
		sendMessageWithContext: useSendWithContext({
			currentRequestContext,
			messages,
			sendMessage,
		}),
	};
}

/** Scrolling: the newest message, the faded edges, and the docked field. */
function useInlineScrolling() {
	const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
		useStickToBottom({ initial: "smooth", resize: "smooth" });
	const dock = useComposerDock({
		isAtBottom,
		scrollToBottom: useCallback(
			() => void scrollToBottom({ animation: "instant" }),
			[scrollToBottom],
		),
	});
	const { edges: scrollEdges, ref: scrollEdgesRef } = useScrollEdges();
	const { watchDockClamp } = dock;
	const messagesScrollRef = useCallback(
		(element: HTMLDivElement | null) => {
			scrollRef(element);
			watchDockClamp(element);
			scrollEdgesRef(element);
		},
		[scrollEdgesRef, scrollRef, watchDockClamp],
	);

	return {
		...dock,
		contentRef,
		isAtBottom,
		messagesScrollRef,
		scrollEdges,
		scrollToBottom,
	};
}

/**
 * Everything the chat beside the results needs: its conversation, what the
 * reader has typed, and the publications it has used so far.
 */
export function useInlineChat({
	modelId,
	searchContext,
}: {
	modelId: AIModelId;
	searchContext?: LibrarySearchContext;
}) {
	const { requestSearchFocus, setEngaged } = useInlineChatLayout();
	const { isDeepResearchEnabled, mode, setMode } = useChatMode();
	const conversation = useInlineConversation({
		mode,
		modelId,
		searchContext,
	});
	const screening = useScreeningControls({
		appendMessage: conversation.appendMessage,
		messages: conversation.messages,
		modelId,
	});
	// Loaded once for the whole chat, so where the cited pages live is worked
	// out from the conversation itself rather than kept anywhere.
	const publications = useBucketPublications(conversation.bucketEntries);
	const [isComposerFocused, setIsComposerFocused] = useState(false);
	const scrolling = useInlineScrolling();
	const isWaiting =
		(conversation.isLoading || screening.isMutating) && !conversation.error;

	const closeChat = useCallback(() => {
		setEngaged(false);
		requestSearchFocus();
	}, [requestSearchFocus, setEngaged]);
	useEscapeToClose(closeChat);

	/**
	 * Asks a question, and answers whether it was taken. A question that
	 * arrives while an answer is still being written is refused, so the field
	 * it came from can keep it rather than losing it. The conversation itself
	 * is asked because two quick presses both happen before the chat is drawn
	 * again, so the state from the last drawing is already out of date.
	 */
	const ask = (question: string) => {
		if (!question.trim()) return false;
		if (screening.isMutating || isAnswering(conversation.chat.status)) {
			return false;
		}
		conversation.sendMessageWithContext(question.trim());

		return true;
	};

	return {
		...conversation,
		...screening,
		...scrolling,
		ask,
		closeChat,
		conversationStarted: conversation.messages.length > 1,
		isComposerFocused,
		isDeepResearchEnabled,
		isWaiting,
		isWaitingForAssistant:
			conversation.isLoading &&
			conversation.messages.at(-1)?.role === "user",
		mode,
		pdfSources: publications.pdfSources,
		prefersReducedMotion: useReducedMotion(),
		publications,
		setIsComposerFocused,
		setMode,
	};
}

/**
 * What the reader has typed into the chat beside the results, and what
 * happens when they send it. The draft is read here rather than in
 * `useInlineChat` so that typing only redraws the message box.
 */
export function useInlineChatComposer({
	ask,
	isWaiting,
	resizeComposer,
}: {
	ask: (question: string) => boolean;
	isWaiting: boolean;
	resizeComposer: () => void;
}) {
	const { draft, setDraft } = useInlineChatDraft();

	// Outside system: the message field's own height. The browser can only
	// measure it once the new text has reached it, so this waits for the
	// draft to be drawn rather than measuring the text it is replacing. It
	// also catches a draft cleared from elsewhere, such as a question handed
	// over from the search field.
	useEffect(() => {
		resizeComposer();
	}, [draft, resizeComposer]);

	return {
		handleSubmit: (event: React.FormEvent) => {
			event.preventDefault();
			// A submit while an answer is arriving is turned away, and the
			// field keeps its text so nothing is lost.
			if (!ask(draft)) return;
			setDraft("");
		},
		input: draft,
		isInputReady: draft.trim().length > 0 && !isWaiting,
		setInput: setDraft,
	};
}
