"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Item pages that a result card prefetched in full. The browser keeps such a
// prefetch for minutes, so the page reads the record again once it opens and
// an edit or unpublish made since then still shows.
const fullyPrefetched = new Set<string>();

export function markFullyPrefetched(itemKey: string) {
	fullyPrefetched.add(itemKey);
}

export function RefreshPrefetchedItem({ itemKey }: { itemKey: string }) {
	const router = useRouter();
	useEffect(() => {
		if (fullyPrefetched.delete(itemKey)) router.refresh();
	}, [itemKey, router]);
	return null;
}
