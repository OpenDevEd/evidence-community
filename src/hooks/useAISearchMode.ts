"use client";

import { useLibraryFeature } from "@/context/LibraryConfigProvider";

/** Which AI search surfaces this library switched on. */
export function useIsAISearchEnabled() {
	return {
		isAISearchEnabled: useLibraryFeature("aiSearch"),
		isDeepResearchEnabled: useLibraryFeature("deepResearch"),
	};
}
