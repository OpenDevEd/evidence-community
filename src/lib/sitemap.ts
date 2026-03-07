import { SITEMAP_SIZE } from "@/constants/misc";
import { getTotalItems } from "@/lib/actions";

export async function getSitemapPageCount() {
	const total = await getTotalItems();
	return Math.max(1, Math.ceil(total / SITEMAP_SIZE));
}

export function getSitemapShardUrl(id: number | string) {
	return `${process.env.BASE_URL}/sitemap/${id}.xml`;
}
