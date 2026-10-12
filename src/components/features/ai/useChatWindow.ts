"use client";

import { useCallback, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useStickToBottom } from "use-stick-to-bottom";

import { bucketEntriesFromMessages, openAccessFromMessages } from "@/lib/ai/context-bucket";
import { isAnswering } from "@/lib/ai/chat-request";
import { withLatestRequestContext } from "@/lib/ai/chat-messages";
import type { ResearchUIMessage } from "@/lib/ai/agent";
import type { AIModelId } from "@/lib/ai/models";
import type { LibrarySearchContext } from "@/lib/search-context";
import type { ChatMode } from "@/types/ai";
import { useScrollEdges } from "./chat-shared";
import { useBucketPublications } from "./ContextBucket";
import {
	useAppendMessage,
	useChatFailure,
	useChatMode,
	useScreeningControls,
	useSendWithContext,
	useTranscriptExport,
	useCurrentRequestContext,
} from "./useChatActions";
import { useTranslations } from "next-intl";
import { useChatWindowSession } from "./useChatWindowSession";
import type { AttachedItem } from "./AskAbout";

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
	publication,
	onPublicationChange,
	mode,
	modelId,
	onConversationStateChange,
	searchContext,
}: {
	/** The publication the next question is about. With `onPublicationChange` it belongs to whoever opened the window; without it, it is where the window starts. */
	publication?: AttachedItem | null;
	onPublicationChange?: (item: AttachedItem | null) => void;
	mode: ChatMode;
	modelId: AIModelId;
	onConversationStateChange?: (hasConversation: boolean) => void;
	searchContext?: LibrarySearchContext;
}) {
	// The publication the next question is about: the one the window was opened
	// for, then whichever the reader attaches or removes. Changing it keeps the
	// conversation; each question carries the one it was asked about.
	const [own, setOwn] = useState<AttachedItem | null>(() => publication ?? null);
	const attached = onPublicationChange ? (publication ?? null) : own;
	const setAttached = onPublicationChange ?? setOwn;
	const publicationKey = attached?.key;
	const {
		chat,
		messages,
		sendMessage,
		error,
		status,
		regenerate,
		setMessages,
		clearError,
	} = useChatWindowSession({
		// The attached publication shows as a chip, so the greeting does not name it.
		greeting: useTranslations("ai")("askMeAnythingPublications"),
		itemKey: publicationKey,
		mode,
		modelId,
		searchContext,
	});

	const currentRequestContext = useCurrentRequestContext(attached, searchContext);

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
		attached,
		setAttached,
		chat,
		chatFailure: useChatFailure(error),
		error,
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
	/** Answers whether the question was taken. */
	onSend: (question: string) => boolean;
}) {
	const [input, setInput] = useState("");
	const [isComposerFocused, setIsComposerFocused] = useState(false);
	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		// A submit while a response is generating is turned away, and the
		// input keeps its text so nothing is lost.
		if (!onSend(input)) return;
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
	publication,
	onPublicationChange,
	modelId,
	onConversationStateChange,
	searchContext,
}: {
	/** The publication the next question is about; see useChatConversation. */
	publication?: AttachedItem | null;
	onPublicationChange?: (item: AttachedItem | null) => void;
	modelId: AIModelId;
	onConversationStateChange?: (hasConversation: boolean) => void;
	searchContext?: LibrarySearchContext;
}) {
	const { isDeepResearchEnabled, mode, setMode } = useChatMode();
	const conversation = useChatConversation({
		publication,
		onPublicationChange,
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
	/**
	 * Asks a question, and answers whether it was taken. A question that
	 * arrives while an answer is still being written is refused, so the field
	 * it came from can keep it rather than losing it. The conversation itself
	 * is asked because two quick clicks both happen before the window is
	 * drawn again, so the state from the last drawing is already out of date.
	 */
	const ask = (question: string) => {
		const asked = question.trim();
		if (!asked) return false;
		if (screening.isMutating || isAnswering(conversation.chat.status)) {
			return false;
		}
		conversation.sendMessageWithContext(asked);

		return true;
	};
	const composer = useChatComposer({ isBusy, onSend: ask });
	// Page links work for every publication the conversation has read, attached or found, as in the chat beside the results.
	const publications = useBucketPublications(
		bucketEntriesFromMessages(conversation.messages),
	);
	const { pdfSources } = publications;
	const scrolling = useChatScrolling();

	return {
		...conversation,
		...screening,
		...composer,
		...scrolling,
		ask,
		getTranscriptContent: useTranscriptExport({
			messages: conversation.messages,
			modelId,
			pdfSources,
		}),
		conversationStarted: conversation.messages.length > 1,
		isDeepResearchEnabled,
		isWaiting: isBusy && !conversation.error,
		mode,
		pdfSources,
		prefersReducedMotion: useReducedMotion(),
		// What its citation links say about open access: the search hits, then the publications once they load.
		cited: { ...openAccessFromMessages(conversation.messages), ...publications.byKey },
		setMode,
	};
}
