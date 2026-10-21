import type { Collection } from "@/app/api/collections/types";
import type { ListItem } from "@/app/api/item/types";
import type { PublicSource } from "@/app/api/sources/types";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { offersSources } from "./search-query";

/**
 * One group a record's card names it a member of, with the list filter that shows the rest of that group: a
 * collection's path from the top, or a source. A source the library doesn't let readers filter by opens nothing.
 */
export type CardTag = {
	group: number;
	from: "collection" | "sources";
	/** What the group is called: its own name, else its parent collection's, or what the library calls its sources. */
	groupName: string;
	name: string;
	filter: { collections: string[] } | { sources: string[] } | null;
	/** The member's own icon and colour, else its group's; none leaves the tag plain. */
	icon?: string;
	color?: string;
};

type Group = LibraryServerConfig["content"]["cardTags"][number];

/** A member's own icon and colour, each falling back to its group's. */
const lookOf = (group: Group, key: string) => {
	const own = group.members[key];
	return { icon: own?.icon ?? group.icon, color: own?.color ?? group.color };
};

/** Works out each record's card tags from the library's `content.cardTags` groups, in their order. */
export function cardTagsFor(
	config: Pick<LibraryServerConfig, "content" | "filters" | "sources">,
	collections: readonly Collection[],
	sources: readonly PublicSource[],
): (item: ListItem) => CardTag[] | undefined {
	const groups = config.content.cardTags.flatMap((group, index) => (group.enabled ? [{ ...group, index }] : []));
	if (groups.length === 0) return () => undefined;
	const byKey = new Map(collections.map((collection) => [collection.key, collection]));
	const filterBySource = offersSources(config);
	return (item) =>
		groups.flatMap((group): CardTag[] => {
			// One source would name every record the same.
			if (group.from === "sources") {
				if (sources.length < 2) return [];
				return sources
					.filter((source) => item.sources?.includes(source.key))
					.map((source) => ({
						group: group.index, from: "sources", groupName: group.name || config.filters.sources.label, name: source.name,
						filter: filterBySource ? { sources: [source.key] } : null, ...lookOf(group, source.key),
					}));
			}
			// Subcollections of the same name under different parents are one tag: the first the record sits in opens it.
			const parents = group.collections.flatMap((id) => byKey.get(id) ?? []);
			if (parents.length === 0) return [];
			const parentKeys = new Set(parents.map((parent) => parent.key));
			const groupName = group.name || (parents[0].name ?? parents[0].key);
			const tags = new Map<string, CardTag>();
			for (const key of item.collectionsAncestry ?? []) {
				const collection = byKey.get(key);
				if (!collection?.parentCollection || !parentKeys.has(collection.parentCollection)) continue;
				const name = collection.name ?? collection.key;
				if (tags.has(name)) continue;
				tags.set(name, {
					group: group.index, from: "collection", groupName, name,
					filter: { collections: [...(collection.ancestry ?? []), collection.key] }, ...lookOf(group, name),
				});
			}
			return [...tags.values()];
		});
}
