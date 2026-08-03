import "server-only";

import { revalidateTag } from "next/cache";

export function revalidatePublishedItemCaches(
	...itemKeys: Array<string | null | undefined>
) {
	for (const itemKey of new Set(itemKeys.filter(Boolean) as string[])) {
		revalidateTag(`item-${itemKey}`, "max");
		revalidateTag(`item-small-${itemKey}`, "max");
		revalidateTag(`item-citation-source-${itemKey}`, "max");
		revalidateTag(`metadata-citation-${itemKey}`, "max");
	}
}
