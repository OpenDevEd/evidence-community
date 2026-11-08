import { SITEMAP_SIZE } from "@/constants/misc";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getDatabaseForConfig } from "@/db";
import { countSitemapRecords } from "@/lib/library-export-records";
import { buildSiteUrl } from "@/lib/site-url";
import { cacheLife, cacheTag } from "next/cache";

async function getSitemapPageCountCached(
	configRevision: string,
	config: LibraryServerConfig,
) {
	'use cache'
	cacheLife({ revalidate: 3600 })
	cacheTag('sitemap-total-' + configRevision)
	const total = await countSitemapRecords(await getDatabaseForConfig(config), config);
	return Math.max(1, Math.ceil(Number(total) / SITEMAP_SIZE));
}

export async function getSitemapPageCount(
	config?: LibraryServerConfig,
) {
	const libraryConfig = config ?? await getLibraryConfig();
	if (!libraryConfig.generation.sitemap) {
		return 0;
	}

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
