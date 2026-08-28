"use client";

import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useLocale } from "next-intl";
import { useEffect, useState } from "react";

import {
	type InlineChatRequest,
	useInlineChatLayout,
} from "@/context/InlineChatLayout";
import type { ResearchUIMessage } from "@/lib/ai/agent";
import { createTextMessage } from "@/lib/ai/chat-messages";
import { getAnalyticsDistinctId } from "@/lib/analytics";
import type { LibrarySearchContext } from "@/lib/search-context";
import type { ChatMode } from "@/types/ai";

/**
 * The conversation beside the search results. It belongs to the page layout
 * rather than to this component, so opening a publication and coming back
 * keeps it. Everything the request needs is read at the moment it is sent.
 */
export function useInlineChatSession({
	greeting,
	mode,
	modelId,
	searchContext,
}: {
	greeting: string;
	mode: ChatMode;
	modelId: string;
	searchContext?: LibrarySearchContext;
}) {
	const locale = useLocale();
	const { getChat, getChatRequest, setChatRequest } = useInlineChatLayout();
	const fallback: InlineChatRequest = { locale, mode, modelId };
	const [chat] = useState(() =>
		getChat(
			modelId,
			() =>
				new Chat<ResearchUIMessage>({
					transport: new DefaultChatTransport({
						api: "/api/ai/chat",
						headers: () => ({
							"Accept-Language": (getChatRequest() ?? fallback)
								.locale,
						}),
						body: () => {
							const request = getChatRequest() ?? fallback;

							return {
								modelId: request.modelId,
								distinctId: getAnalyticsDistinctId(),
								mode: request.mode,
								searchContext: request.searchContext,
							};
						},
					}),
					messages: [createTextMessage("assistant", greeting, "start")],
				}),
		),
	);

	// Stored after each change rather than during the render, because the
	// request only reads them when the reader actually sends something.
	useEffect(() => {
		setChatRequest({ locale, mode, modelId, searchContext });
	}, [locale, mode, modelId, searchContext, setChatRequest]);

	return useChat<ResearchUIMessage>({ throttle: 50, chat });
}
