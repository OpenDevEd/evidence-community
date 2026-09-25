"use client";

import { useEffect } from "react";
import { useIsAISearchEnabled } from "@/hooks/useAISearchMode";
import { usePathname } from "@/i18n/routing";
import type { LibrarySearchContext } from "@/lib/search-context";
import { useAskInlineChat } from "./useAskInlineChat";
import { forgetWaitingQuestion, onQuestionHandedOver, waitingQuestion } from "./handed-over-question";

const LIBRARY_LIST = /^\/lib\/?$/;

/**
 * Asks a question handed over from another page (the home page's "Ask the library") once the chat can take it, then
 * forgets it. If the chat is still answering, it tries again each second; subscribing to the chat would redraw the
 * whole listing per token. The library list keeps this running whether or not the chat beside it is open, and Next
 * keeps a visited list alive between visits, so a question handed over later arrives as an event too.
 */
/** `searchContext` is undefined on lists that never ask it (a profile's saved records). */
function useHandedOverQuestion(searchContext: LibrarySearchContext | undefined) {
	const enabled = searchContext !== undefined;
	const askInline = useAskInlineChat(searchContext);
	const { isAISearchEnabled } = useIsAISearchEnabled();
	// Only the library list asks it: other result lists (the map's, for one) have no chat and their own filters.
	const onLibraryList = LIBRARY_LIST.test(usePathname());
	useEffect(() => {
		if (!isAISearchEnabled || !enabled || !onLibraryList) return;
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
	}, [askInline, enabled, isAISearchEnabled, onLibraryList]);
}

/** Renders nothing; lets a list ask handed-over questions without adding a hook to its own component. */
export function AskHandedOverQuestion({ searchContext }: { searchContext: LibrarySearchContext | undefined }) {
	useHandedOverQuestion(searchContext);
	return null;
}
