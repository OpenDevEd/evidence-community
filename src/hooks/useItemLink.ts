"use client";

import { useSyncExternalStore } from "react";
import { useQueryState } from "nuqs";
import { usePathname } from "@/i18n/routing";
import { useResourceHref } from "@/hooks/useResourceHref";
import { recordReferrer } from "@/constants/misc";
import { preloadItemCovers } from "@/components/features/items/PdfCover";
import type { Item, ListItem } from "@/app/api/item/types";

// Clicks that opened a record's page from a full prefetch, by record. The browser keeps such a prefetch for minutes, so
// each of these clicks has the page read its record again, and an edit or unpublish made since then still shows.
const prefetchedClicks = new Map<string, number>();
const clickListeners = new Set<() => void>();
const subscribeToClicks = (listener: () => void) => {
	clickListeners.add(listener);
	return () => {
		clickListeners.delete(listener);
	};
};

/** How many times this record's page was opened from a full prefetch. A page kept for Back sees a later click as well. */
export function usePrefetchedClicks(itemKey: string) {
	return useSyncExternalStore(subscribeToClicks, () => prefetchedClicks.get(itemKey) ?? 0, () => 0);
}

function countPrefetchedClick(itemKey: string) {
	prefetchedClicks.set(itemKey, (prefetchedClicks.get(itemKey) ?? 0) + 1);
	clickListeners.forEach((listener) => listener());
}

/**
 * A link to a publication's page as a result card makes it: the current search comes along, and the profile it is on,
 * pointing at it starts loading the page's covers, and `fullPrefetch` loads the whole page ahead. A click on a page
 * loaded ahead is counted, so the page reads its record again.
 */
export function useItemLink(item: Item | ListItem | undefined, { fullPrefetch = false } = {}) {
	const [referrer] = useQueryState("referrer");
	const currentPath = usePathname();
	const resourceHref = useResourceHref();
	const key = item?.key;
	const prefetched = fullPrefetch && key ? key : undefined;
	const prepare = () => preloadItemCovers(item);
	return {
		href: key
			? resourceHref(key, { set: { referrer: recordReferrer(currentPath, referrer) } })
			: "",
		prefetch: Boolean(prefetched) || undefined,
		onPointerEnter: prepare,
		onFocus: prepare,
		onTouchStart: prepare,
		onClick: () => {
			if (prefetched) countPrefetchedClick(prefetched);
		},
	};
}
