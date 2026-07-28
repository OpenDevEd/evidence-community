import type { GapMap } from "@/lib/gapmap-links";

import type { LibraryServerConfig } from "./schema";

type ConfiguredGapMap = LibraryServerConfig["gapMaps"][number];

export function getGapMapPath(slug: string) {
	return `/gapmaps/${slug}.html`;
}

export function getEnabledGapMaps(
	gapMaps: readonly ConfiguredGapMap[],
): GapMap[] {
	return gapMaps
		.filter((gapMap) => gapMap.enabled)
		.map(({ slug, label, description }) => ({
			slug,
			label,
			description,
			href: getGapMapPath(slug),
		}));
}

export function findEnabledGapMap(
	gapMaps: readonly ConfiguredGapMap[],
	slug: string,
) {
	return gapMaps.find(
		(gapMap) => gapMap.enabled && gapMap.slug === slug,
	);
}

export function isApprovedGapMapContentType(
	contentType: string | null,
) {
	if (!contentType) return false;

	const mediaType = contentType
		.split(";", 1)[0]
		.trim()
		.toLowerCase();

	return (
		mediaType === "text/html" ||
		mediaType === "application/xhtml+xml"
	);
}
