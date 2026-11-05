import { createHash } from "node:crypto";

import type { LibraryServerConfig } from "@/config/library-config/schema";

import type { ShownCollections } from "./topic-stats";

/** Part of the cache key: raise it when the statistics change what they count, so a deployment never serves figures cached by the code before it. */
const STATISTICS_VERSION = 6;

/**
 * Names the figures by what they count: the database they read, the records hidden from readers, whether topics are on,
 * the shown collections (topics are named from them, so renaming or moving one counts afresh) and the citation measure.
 * Counting a large library takes minutes, so a revision that changes anything else, a logo or a page's text, keeps them.
 */
export function statisticsCacheKey(
	config: Pick<LibraryServerConfig, "content" | "services" | "topics">,
	shown: ShownCollections,
	measureKey: string,
) {
	const counted = createHash("sha256")
		.update(JSON.stringify([config.services.database.url, [...shown], [...config.content.tags.hidden].sort(), config.topics.enabled]))
		.digest("hex")
		.slice(0, 16);
	return `comprehensive-stats-v${STATISTICS_VERSION}-${counted}-${measureKey}`;
}
