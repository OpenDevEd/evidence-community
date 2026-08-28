"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useLocale, useTranslations } from "next-intl";

import type { ResearchUIMessage } from "@/lib/ai/agent";
import { getAnalyticsDistinctId } from "@/lib/analytics";
import type { LibrarySearchContext } from "@/lib/search-context";
import type { ChatMode } from "@/types/ai";

/** The greeting the reader sees before they ask anything. */
function chatGreeting(text: string): ResearchUIMessage {
	return {
		id: "start",
		role: "assistant",
		parts: [{ type: "text", text }],
	} as ResearchUIMessage;
}

/**
 * One conversation with the library's assistant: the request carries the
 * chosen model, the mode, the open publication, and the reader's own search.
 */
export function useChatWindowSession({
	itemKey,
	greeting,
	mode,
	modelId,
	searchContext,
}: {
	itemKey?: string;
	greeting: string;
	mode: ChatMode;
	modelId: string;
	searchContext?: LibrarySearchContext;
}) {
	const locale = useLocale();

	return useChat<ResearchUIMessage>({
		throttle: 50,
		transport: new DefaultChatTransport({
			api: "/api/ai/chat",
			headers: { "Accept-Language": locale },
			body: () => ({
				itemKey,
				modelId,
				distinctId: getAnalyticsDistinctId(),
				mode,
				searchContext,
			}),
		}),
		messages: [chatGreeting(greeting)],
	});
}

/** The greeting text for a publication chat, or the whole library. */
export function useChatGreeting(publicationTitle?: string) {
	const t = useTranslations("ai");
	return t("chatPlaceholder", { title: publicationTitle || "" });
}
