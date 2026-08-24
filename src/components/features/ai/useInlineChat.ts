"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useStickToBottom } from "use-stick-to-bottom";

import { useInlineChatLayout } from "@/context/InlineChatLayout";
import { bucketEntriesFromMessages } from "@/lib/ai/context-bucket";
import { createResearchRequestContextSnapshot } from "@/lib/ai/request-context";
import type { AIModelId } from "@/lib/ai/models";
import type { ChatMode } from "@/types/ai";
import type { LibrarySearchContext } from "@/lib/search-context";
import { useScrollEdges } from "./chat-shared";
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

	// The model picker and the screening settings own Esc while they are open.
	return !document.querySelector('[role="dialog"]');
}

/** Esc closes the chat, unless a dialog on top of it wants the key. */
function useEscapeToClose(closeChat: () => void) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!closesTheChat(event)) return;
			event.preventDefault();
			closeChat();
		};

		document.addEventListener("keydown", onKeyDown);

		return () => document.removeEventListener("keydown", onKeyDown);
	}, [closeChat]);
}

/** Text typed but not sent survives leaving the page and coming back. */
function useComposerDraft() {
	const {
		composerDraft,
		pendingInput,
		pendingSend,
		setComposerDraft,
		setPendingInput,
		setPendingSend,
	} = useInlineChatLayout();
	// A question that is about to be asked should not also fill the box.
	const [input, setInput] = useState(() =>
		pendingSend ? "" : pendingInput || composerDraft,
	);
	const inputRef = useRef(input);

	useEffect(() => {
		inputRef.current = input;
	}, [input]);
	useEffect(
		() => () => setComposerDraft(inputRef.current),
		[setComposerDraft],
	);
	useEffect(
		() => () => {
			setPendingInput("");
			setPendingSend(false);
		},
		[setPendingInput, setPendingSend],
	);

	return { input, setInput };
}

/** The question typed in the search bar is asked once, when the chat opens. */
function useOpeningQuestion({
	onAsk,
	onReady,
}: {
	onAsk: (question: string) => void;
	onReady: () => void;
}) {
	const { pendingInput, pendingSend } = useInlineChatLayout();
	const askedRef = useRef(false);
	const askRef = useRef({ onAsk, onReady, pendingInput, pendingSend });

	useEffect(() => {
		askRef.current = { onAsk, onReady, pendingInput, pendingSend };
	});
	useEffect(() => {
		if (askedRef.current) return;
		askedRef.current = true;
		const { onAsk: ask, onReady: ready, ...pending } = askRef.current;
		if (pending.pendingSend && pending.pendingInput.trim()) {
			ask(pending.pendingInput.trim());
		}
		ready();
	}, []);
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
	const { setBucketEntries } = useInlineChatLayout();
	const {
		messages,
		sendMessage,
		error,
		status,
		regenerate,
		setMessages,
		clearError,
	} = useInlineChatSession({
		greeting: t("askMeAnythingPublications"),
		mode,
		modelId,
		searchContext,
	});
	const currentRequestContext = useCallback(
		() => createResearchRequestContextSnapshot({ searchContext }),
		[searchContext],
	);
	const resetChat = useCallback(() => {
		clearError();
		setMessages((current) => current.slice(0, 1));
		setBucketEntries([]);
	}, [clearError, setBucketEntries, setMessages]);

	// What the assistant has used is read back out of the conversation, so it
	// is right again after leaving the page and coming back.
	useEffect(() => {
		setBucketEntries(bucketEntriesFromMessages(messages));
	}, [messages, setBucketEntries]);

	return {
		appendMessage: useAppendMessage(setMessages),
		chatFailure: useChatFailure(error),
		error,
		getTranscriptContent: useTranscriptExport({ messages, modelId }),
		isLoading: status === "submitted" || status === "streaming",
		messages,
		reload: useCallback(() => regenerate(), [regenerate]),
		resetChat,
		sendMessageWithContext: useSendWithContext({
			currentRequestContext,
			messages,
			sendMessage,
		}),
	};
}

/** Scrolling: the newest message, the faded edges, and the docked field. */
function useInlineScrolling(input: string) {
	const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
		useStickToBottom({ initial: "smooth", resize: "smooth" });
	const dock = useComposerDock({
		isAtBottom,
		scrollToBottom: useCallback(
			() => void scrollToBottom({ animation: "instant" }),
			[scrollToBottom],
		),
		value: input,
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
	const { bucketEntries, pdfSources, requestSearchFocus, setEngaged } =
		useInlineChatLayout();
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
	const { input, setInput } = useComposerDraft();
	const [isComposerFocused, setIsComposerFocused] = useState(false);
	const scrolling = useInlineScrolling(input);
	const isWaiting =
		(conversation.isLoading || screening.isMutating) && !conversation.error;

	const closeChat = useCallback(() => {
		setEngaged(false);
		requestSearchFocus();
	}, [requestSearchFocus, setEngaged]);
	useEscapeToClose(closeChat);
	useOpeningQuestion({
		onAsk: conversation.sendMessageWithContext,
		onReady: scrolling.focusComposer,
	});

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		// Ignore submits while an answer is arriving; the field keeps its text
		// so nothing is lost.
		if (isWaiting || !input.trim()) return;
		conversation.sendMessageWithContext(input);
		setInput("");
	};

	return {
		...conversation,
		...screening,
		...scrolling,
		bucketEntries,
		closeChat,
		conversationStarted: conversation.messages.length > 1,
		handleSubmit,
		input,
		isComposerFocused,
		isDeepResearchEnabled,
		isInputReady: input.trim().length > 0 && !isWaiting,
		isWaiting,
		isWaitingForAssistant:
			conversation.isLoading &&
			conversation.messages.at(-1)?.role === "user",
		mode,
		pdfSources,
		prefersReducedMotion: useReducedMotion(),
		setInput,
		setIsComposerFocused,
		setMode,
	};
}
