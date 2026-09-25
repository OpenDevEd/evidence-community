"use client";

import { useEffect } from "react";
import { useIsAISearchEnabled } from "@/hooks/useAISearchMode";
import type { LibrarySearchContext } from "@/lib/search-context";
import { useAskInlineChat } from "./useAskInlineChat";
import { forgetWaitingQuestion, onQuestionHandedOver, waitingQuestion } from "./handed-over-question";

/**
 * Asks a question handed over from another page (the home page's "Ask the library") once the chat can take it, then
 * forgets it. If the chat is still answering, it tries again each second; subscribing to the chat would redraw the
 * whole listing per token. The library list keeps this running whether or not the chat beside it is open, and Next
 * keeps a visited list alive between visits, so a question handed over later arrives as an event too.
 */
export function useHandedOverQuestion(searchContext: LibrarySearchContext | undefined, enabled: boolean) {
	const askInline = useAskInlineChat(searchContext);
	const { isAISearchEnabled } = useIsAISearchEnabled();
	useEffect(() => {
		if (!isAISearchEnabled || !enabled) return;
		let retry: ReturnType<typeof setInterval> | undefined;
		const ask = () => {
			const question = waitingQuestion();
			if (question && !askInline(question)) return false;
			forgetWaitingQuestion();
			return true;
		};
		const askWhenFree = () => {
			if (retry || ask()) return;
			retry = setInterval(() => {
				if (!ask()) return;
				clearInterval(retry);
				retry = undefined;
			}, 1000);
		};
		if (waitingQuestion()) askWhenFree();
		const stopListening = onQuestionHandedOver(askWhenFree);
		return () => {
			stopListening();
			clearInterval(retry);
		};
	}, [askInline, enabled, isAISearchEnabled]);
}
