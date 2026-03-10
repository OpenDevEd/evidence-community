import { SITEMAP_SIZE } from "@/constants/misc";
import { getTotalItems } from "@/lib/actions";
import { buildSiteUrl } from "@/lib/site-url";
import { cacheLife, cacheTag } from "next/cache";

export async function getSitemapPageCount() {
	'use cache'
	cacheLife({ revalidate: 3600 })
	cacheTag('sitemap-total')
	const total = await getTotalItems();
	return Math.max(1, Math.ceil(total / SITEMAP_SIZE));
}

export function getSitemapShardUrl(id: number | string) {
	return buildSiteUrl(`/sitemap/${id}.xml`);
}
