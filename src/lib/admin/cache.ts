import "server-only";

import { revalidateTag } from "next/cache";

import type { AdminSearchIndexReceiptStatus } from "./search-index-contract";

const IMMEDIATE_EXPIRY = { expire: 0 } as const;

export function revalidateIndexedReceiptCaches(
	receipts: readonly AdminSearchIndexReceiptStatus[],
) {
	const tags = new Set<string>();
	for (const receipt of receipts) {
		if (receipt.state !== "indexed") continue;
		if (receipt.entityType === "collection") {
			tags.add("collections");
			continue;
		}
		tags.add(`item-${receipt.entityKey}`);
		tags.add(`item-small-${receipt.entityKey}`);
		tags.add(`item-citation-source-${receipt.entityKey}`);
		tags.add(`metadata-citation-${receipt.entityKey}`);
	}
	for (const tag of tags) revalidateTag(tag, IMMEDIATE_EXPIRY);
}
