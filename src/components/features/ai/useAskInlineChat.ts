"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";

import {
	useInlineChatDraft,
	useInlineChatLayout,
} from "@/context/InlineChatLayout";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { researchMessageParts } from "@/lib/ai/chat-messages";
import { chatRequestOptions, isAnswering } from "@/lib/ai/chat-request";
import { createResearchRequestContextSnapshot } from "@/lib/ai/request-context";
import type { LibrarySearchContext } from "@/lib/search-context";
import { useChatMode } from "./useChatActions";
import { questionPublication } from "./AskAbout";

/**
 * Hands a question typed elsewhere on the library page to the chat beside the
 * results. The question is sent as the reader asks it: the conversation lives
 * in the page layout, so it does not have to wait for the chat to be drawn.
 *
 * It answers whether the question was taken. A question that arrives while an
 * answer is still being written is refused, so the page can leave it in the
 * field the reader typed it in rather than losing it.
 */
export function useAskInlineChat(searchContext?: LibrarySearchContext) {
	const locale = useLocale();
	const greeting = useTranslations("ai")("askMeAnythingPublications");
	const { mode } = useChatMode();
	const { selectedModelId } = useSelectedModel();
	const { getInlineChat, setEngaged } = useInlineChatLayout();
	const { attached, setDraft } = useInlineChatDraft();

	return useCallback(
		(text: string) => {
			const question = text.trim();
			// The reader asked, so show them the chat either way.
			setEngaged(true);
			if (!question || !selectedModelId) return false;

			const chat = getInlineChat(selectedModelId, greeting);
			if (isAnswering(chat.status)) return false;

			// A question that has been asked should not also fill the box.
			setDraft("");
			// The page clears this text after accepting the question. Keep its
			// other filters, but do not search for the question as literal text.
			const questionContext = searchContext
				? { ...searchContext, search: "" }
				: undefined;
			void chat.sendMessage(
				{
					parts: researchMessageParts(
						chat.messages,
						createResearchRequestContextSnapshot({
							currentPublication: questionPublication(attached),
							searchContext: questionContext,
						}),
						question,
					),
				},
				chatRequestOptions({
					itemKey: attached?.key,
					locale,
					mode,
					modelId: selectedModelId,
					searchContext: questionContext,
				}),
			);

			return true;
		},
		[
			attached,
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
