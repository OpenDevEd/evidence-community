import type { ChatStatus } from "ai";

import { getAnalyticsDistinctId } from "@/lib/analytics";
import type { LibrarySearchContext } from "@/lib/search-context";
import type { ChatMode } from "@/types/ai";

/**
 * What one question to the library assistant is sent with. A conversation
 * outlives the screen around it, so these values travel with each question
 * rather than being baked in when the conversation is made.
 */
export type ChatRequest = {
	/** The publication the reader has open, when they have one. */
	itemKey?: string;
	locale: string;
	mode: ChatMode;
	modelId: string;
	searchContext?: LibrarySearchContext;
};

/** The headers and extra body fields one question carries. */
export function chatRequestOptions({
	itemKey,
	locale,
	mode,
	modelId,
	searchContext,
}: ChatRequest) {
	return {
		headers: { "Accept-Language": locale },
		body: {
			itemKey,
			modelId,
			distinctId: getAnalyticsDistinctId(),
			mode,
			searchContext,
		},
	};
}

/**
 * True while an answer is on its way. The AI service happily runs two
 * questions at once and mixes the answers together, so a second question has
 * to be turned away until the first one is done.
 */
export function isAnswering(status: ChatStatus) {
	return status === "submitted" || status === "streaming";
}
