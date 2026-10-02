"use client";

import { useQueryState } from "nuqs";
import { usePathname } from "@/i18n/routing";
import { useResourceHref } from "@/hooks/useResourceHref";
import { preloadItemCovers } from "@/components/features/items/PdfCover";
import { markFullyPrefetched } from "@/components/features/newlib/RefreshPrefetchedItem";
import type { Item, ListItem } from "@/app/api/item/types";

/**
 * A link to a publication's page as a result card makes it: the current search comes along with where to go back to,
 * pointing at it starts loading the page's covers, and `fullPrefetch` loads the whole page ahead. A click on a page
 * loaded ahead marks it, so the page reads the record again once it opens.
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
			? resourceHref(key, {
					set: {
						referrer: referrer ?? "/" + (currentPath.startsWith("/lib") ? "lib" : currentPath.split("/").slice(1).join("/")),
					},
				})
			: "",
		prefetch: Boolean(prefetched) || undefined,
		onPointerEnter: prepare,
		onFocus: prepare,
		onTouchStart: prepare,
		onClick: () => {
			if (prefetched) markFullyPrefetched(prefetched);
		},
	};
}
