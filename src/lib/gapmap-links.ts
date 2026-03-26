export type GapMap = {
	slug: string;
	label: string;
	href: string;
	description?: string;
};

const GAPMAP_TAG_PREFIX = /^gapmaps?:/i;

export function normalizeGapMapSlug(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\/[^/]+/i, "")
		.replace(/^\/?gapmaps\//i, "")
		.replace(/^[^/]+\//, "")
		.replace(/\.html$/i, "")
		.replace(/[_\s]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

export function getGapMapSlugsFromTags(tags?: string[] | null): string[] {
	if (!tags?.length) return [];

	return Array.from(
		new Set(
			tags
				.map((tag) => {
					if (!GAPMAP_TAG_PREFIX.test(tag)) return null;
					return normalizeGapMapSlug(tag.replace(GAPMAP_TAG_PREFIX, ""));
				})
				.filter((slug): slug is string => Boolean(slug)),
		),
	);
}

export function resolveGapMapsByTags(
	tags: string[] | null | undefined,
	gapmaps: GapMap[],
): GapMap[] {
	const slugs = new Set(getGapMapSlugsFromTags(tags));

	if (!slugs.size) return [];

	return gapmaps.filter((gapmap) =>
		slugs.has(normalizeGapMapSlug(gapmap.slug)) ||
		slugs.has(normalizeGapMapSlug(gapmap.href)),
	);
}
