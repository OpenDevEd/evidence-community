"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";

import {
	useInlineChatDraft,
	useInlineChatLayout,
} from "@/context/InlineChatLayout";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { researchMessageParts } from "@/lib/ai/chat-messages";
import { inlineChatRequestOptions } from "@/lib/ai/inline-chat-request";
import { createResearchRequestContextSnapshot } from "@/lib/ai/request-context";
import type { LibrarySearchContext } from "@/lib/search-context";
import { useChatMode } from "./useChatActions";

/**
 * Hands a question typed elsewhere on the library page to the chat beside the
 * results. The question is sent as the reader asks it: the conversation lives
 * in the page layout, so it does not have to wait for the chat to be drawn.
 */
export function useAskInlineChat(searchContext?: LibrarySearchContext) {
	const locale = useLocale();
	const greeting = useTranslations("ai")("askMeAnythingPublications");
	const { mode } = useChatMode();
	const { selectedModelId } = useSelectedModel();
	const { getInlineChat, setEngaged } = useInlineChatLayout();
	const { setDraft } = useInlineChatDraft();

	return useCallback(
		(text: string) => {
			const question = text.trim();
			// A question that has been asked should not also fill the box.
			setDraft("");
			setEngaged(true);
			if (!question || !selectedModelId) return;

			const chat = getInlineChat(selectedModelId, greeting);
			void chat.sendMessage(
				{
					parts: researchMessageParts(
						chat.messages,
						createResearchRequestContextSnapshot({ searchContext }),
						question,
					),
				},
				inlineChatRequestOptions({
					locale,
					mode,
					modelId: selectedModelId,
					searchContext,
				}),
			);
		},
		[
			getInlineChat,
			greeting,
			locale,
			mode,
			searchContext,
			selectedModelId,
			setDraft,
			setEngaged,
		],
	);
}
