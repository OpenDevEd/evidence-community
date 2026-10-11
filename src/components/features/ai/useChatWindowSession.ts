"use client";

import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useLocale } from "next-intl";
import { useState } from "react";

import type { ResearchUIMessage } from "@/lib/ai/agent";
import { createTextMessage } from "@/lib/ai/chat-messages";
import type { LibrarySearchContext } from "@/lib/search-context";
import type { ChatMode } from "@/types/ai";
import { useChatSession } from "./useChatSession";

/** The conversation in the full-screen chat window. */
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
	const [chat] = useState(
		() =>
			new Chat<ResearchUIMessage>({
				transport: new DefaultChatTransport({ api: "/api/ai/chat" }),
				messages: [createTextMessage("assistant", greeting, "start")],
			}),
	);

	return useChatSession(chat, {
		itemKey,
		locale: useLocale(),
		mode,
		modelId,
		searchContext,
	});
}
