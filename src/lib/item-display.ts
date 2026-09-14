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

type ContentTags = LibraryPublicConfig["content"]["tags"];
export function ordinaryItemTags(tags: readonly string[], config: ContentTags) {
	return tags.filter(
		(tag) =>
			!ITEM_DISPLAY_OPTIONS.some(({ key }) =>
				hasAnyTag([tag], config[key]),
			),
	);
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
