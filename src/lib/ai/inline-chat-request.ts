import { getAnalyticsDistinctId } from "@/lib/analytics";
import type { LibrarySearchContext } from "@/lib/search-context";
import type { ChatMode } from "@/types/ai";

/**
 * What one question to the library assistant is sent with. The chat beside
 * the results outlives the page around it, so these values travel with each
 * question rather than being baked into the conversation when it is made.
 */
export type InlineChatRequest = {
	locale: string;
	mode: ChatMode;
	modelId: string;
	searchContext?: LibrarySearchContext;
};

/** The headers and extra body fields one question carries. */
export function inlineChatRequestOptions({
	locale,
	mode,
	modelId,
	searchContext,
}: InlineChatRequest) {
	return {
		headers: { "Accept-Language": locale },
		body: {
			modelId,
			distinctId: getAnalyticsDistinctId(),
			mode,
			searchContext,
		},
	};
}
