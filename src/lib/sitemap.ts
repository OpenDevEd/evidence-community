import { SITEMAP_SIZE } from "@/constants/misc";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { buildSiteUrl } from "@/lib/site-url";
import { cacheLife, cacheTag } from "next/cache";

async function getSitemapPageCountCached(
	configRevision: string,
	config: LibraryServerConfig,
) {
	'use cache'
	cacheLife({ revalidate: 3600 })
	cacheTag('sitemap-total-' + configRevision)
	const { index } = await getMeilisearchForConfig(config);
	const stats = await index.getStats();
	const total = stats.numberOfDocuments;
	return Math.max(1, Math.ceil(total / SITEMAP_SIZE));
}

export async function getSitemapPageCount(
	config?: LibraryServerConfig,
) {
	const libraryConfig = config ?? await getLibraryConfig();
	return getSitemapPageCountCached(
		libraryConfig.revision,
		libraryConfig,
	);
}

export function getSitemapShardUrl(
	id: number | string,
	baseUrl: string,
) {
	return buildSiteUrl(`/sitemap/${id}.xml`, baseUrl);
}
