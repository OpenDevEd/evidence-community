"use client";

import { useChat } from "@ai-sdk/react";
import { useLocale } from "next-intl";
import { useCallback, useState } from "react";

import { useInlineChatLayout } from "@/context/InlineChatLayout";
import type { ResearchUIMessage } from "@/lib/ai/agent";
import { inlineChatRequestOptions } from "@/lib/ai/inline-chat-request";
import type { LibrarySearchContext } from "@/lib/search-context";
import type { ChatMode } from "@/types/ai";

/**
 * The conversation beside the search results. It belongs to the page layout
 * rather than to this component, so opening a publication and coming back
 * keeps it. The model, the mode, the language and the reader's own search
 * travel with each question instead of being stored somewhere in between.
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
	const { getInlineChat } = useInlineChatLayout();
	const [chat] = useState(() => getInlineChat(modelId, greeting));
	const { sendMessage, regenerate, ...rest } = useChat<ResearchUIMessage>({
		throttle: 50,
		chat,
	});
	return {
		...rest,
		// The request is built again for every question, so a new model, mode
		// or search is used straight away.
		sendMessage: useCallback(
			(message: { parts: ResearchUIMessage["parts"] }) =>
				sendMessage(
					message,
					inlineChatRequestOptions({
						locale,
						mode,
						modelId,
						searchContext,
					}),
				),
			[sendMessage, locale, mode, modelId, searchContext],
		),
		regenerate: useCallback(
			() =>
				regenerate(
					inlineChatRequestOptions({
						locale,
						mode,
						modelId,
						searchContext,
					}),
				),
			[regenerate, locale, mode, modelId, searchContext],
		),
	};
}
