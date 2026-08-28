"use client";

import { type Chat, useChat } from "@ai-sdk/react";
import { useCallback } from "react";

import type { ResearchUIMessage } from "@/lib/ai/agent";
import { chatRequestOptions, type ChatRequest } from "@/lib/ai/chat-request";

/**
 * One conversation with the library's assistant. The conversation is made
 * once and kept, so the open publication, the chosen model, the mode, the
 * language and the reader's own search travel with every question rather than
 * being fixed when it was made.
 */
export function useChatSession(
	chat: Chat<ResearchUIMessage>,
	{ itemKey, locale, mode, modelId, searchContext }: ChatRequest,
) {
	const { sendMessage, regenerate, ...rest } = useChat<ResearchUIMessage>({
		throttle: 50,
		chat,
	});
	return {
		...rest,
		// The conversation itself, for anything that has to know right now
		// whether an answer is arriving rather than at the last redraw.
		chat,
		sendMessage: useCallback(
			(message: { parts: ResearchUIMessage["parts"] }) =>
				sendMessage(
					message,
					chatRequestOptions({
						itemKey,
						locale,
						mode,
						modelId,
						searchContext,
					}),
				),
			[sendMessage, itemKey, locale, mode, modelId, searchContext],
		),
		regenerate: useCallback(
			() =>
				regenerate(
					chatRequestOptions({
						itemKey,
						locale,
						mode,
						modelId,
						searchContext,
					}),
				),
			[regenerate, itemKey, locale, mode, modelId, searchContext],
		),
	};
}
