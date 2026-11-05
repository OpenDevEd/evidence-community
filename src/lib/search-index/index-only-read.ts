import "server-only";

import type { Item } from "@/app/api/item/types";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getSearchForConfig } from "@/lib/elasticsearch";
import { type ItemSearchDocument, publicItemFrom } from "./projection";

type Config = Pick<LibraryServerConfig, "content" | "revision" | "services" | "updatedAt">;

/** A record of an index-only library, read from its index; null when there is none or readers can't see it. */
export async function readIndexedItem(key: string, config: Config & LibraryServerConfig): Promise<Item | null> {
	const { alias, client } = await getSearchForConfig(config);
	const { docs } = await client.mget<ItemSearchDocument>({ index: alias, ids: [key] });
	const [doc] = docs;
	if (doc && "error" in doc) throw new Error(`Reading record ${key} failed: ${doc.error.reason ?? doc.error.type}`);
	return doc?.found && doc._source ? publicItemFrom(doc._source, config) : null;
}

/** An index-only library's public record count, which every page's layout reads. */
export async function readIndexedStatus(config: Config) {
	const { alias, client } = await getSearchForConfig(config);
	// Before the first load finishes, the alias reaches no index yet.
	const { count } = await client.count({ index: alias }, { ignore: [404] });
	return { totalItems: count ?? 0, latestPublicationUpdatedAt: null };
}
