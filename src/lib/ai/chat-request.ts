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

/**
 * The reader's analytics id as a piece of a request body, or nothing at all.
 *
 * A reader who has not agreed to analytics, or a library with analytics
 * switched off, has no id. The library only accepts a real one, so the field
 * is left out rather than sent empty: sending it empty made every question
 * from such a reader be refused.
 */
export function analyticsIdField(distinctId: string | null | undefined) {
	return distinctId ? { distinctId } : {};
}

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
			...analyticsIdField(getAnalyticsDistinctId()),
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
