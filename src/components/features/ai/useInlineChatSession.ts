"use client";

import { useLocale } from "next-intl";
import { useState } from "react";

import { useInlineChatLayout } from "@/context/InlineChatLayout";
import type { LibrarySearchContext } from "@/lib/search-context";
import type { ChatMode } from "@/types/ai";
import { useChatSession } from "./useChatSession";

/**
 * The conversation beside the search results. It belongs to the page layout
 * rather than to this component, so opening a publication and coming back
 * keeps it, and a question can be asked before the chat is drawn.
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
	const { getInlineChat } = useInlineChatLayout();
	const [chat] = useState(() => getInlineChat(modelId, greeting));

	return useChatSession(chat, {
		locale: useLocale(),
		mode,
		modelId,
		searchContext,
	});
}
