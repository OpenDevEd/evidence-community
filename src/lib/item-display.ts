import type { LibraryPublicConfig } from "@/config/library-config/schema";
import { hasAnyTag } from "./tags";

export const ITEM_DISPLAY_OPTIONS = [
	{
		key: "hidden",
		label: "Hide from library",
		description: "Exclude this item from public pages and search.",
	},
	{
		key: "internal",
		label: "Available on request",
		description: "Show an availability label. The item stays public.",
	},
	{
		key: "comingSoon",
		label: "Coming soon",
		description: "Show that this item is still in progress.",
	},
] as const;

/** A tag the library itself reads: display state, publication marker, category marker. Controls manage these, never chips. */
function isSystemTag(tag: string, config: Pick<LibraryPublicConfig, "content" | "sourcePublishTags">) {
	return [...Object.values(config.content.tags), ...Object.values(config.sourcePublishTags)].some((aliases) => hasAnyTag([tag], aliases));
}

export function ordinaryItemTags(tags: readonly string[], config: Pick<LibraryPublicConfig, "content" | "sourcePublishTags">) {
	return tags.filter((tag) => !isSystemTag(tag, config));
}

export function setItemDisplayTag(
	tags: readonly string[],
	aliases: readonly string[],
	enabled: boolean,
) {
	if (enabled)
		return hasAnyTag(tags, aliases) || !aliases[0]
			? [...tags]
			: [...tags, aliases[0]];
	return tags.filter((tag) => !hasAnyTag([tag], aliases));
}
