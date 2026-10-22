import type { LibraryPublicConfig } from "@/config/library-config/schema";
import { selectionFrontier, type TopicSelectionNode } from "./topics/selection";

export type CollectionsMatch = "any" | "all";

/** Whether ticked collections match any or all: the reader's choice where the library lets them switch, else the library's. */
export function collectionsMatch(match: string | undefined, filters: Pick<LibraryPublicConfig["filters"], "collectionsMatch">): CollectionsMatch {
	const { default: fallback, readerSwitch } = filters.collectionsMatch;
	return readerSwitch && (match === "any" || match === "all") ? match : fallback;
}

/** Collections as the tree's nodes, for reading ticks the way the topic tree does. */
export const collectionNodes = (collections: readonly { key: string; parentCollection: string | null }[]): TopicSelectionNode[] =>
	collections.map((collection) => ({ id: collection.key, parent: collection.parentCollection }));

/** The ticked collections no other ticked one sits under: a ticked child narrows its ticked parent. */
export function deepestTicked(ticked: readonly string[], nodes: readonly TopicSelectionNode[]) {
	const known = selectionFrontier(ticked, nodes);
	return known.length > 0 ? known : [...ticked];
}
