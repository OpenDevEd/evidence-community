import meilisearchClient from "@/lib/meilisearch";
import { MetadataRoute } from 'next'
import { routing } from '@/i18n/routing'
import config from "@/constants/config.json";

const locales = routing.locales.map((locale) => locale);

const LIMIT_PER_SITEMAP = 10000;

function getItems(args: {
    [key: string]: any;
} = {}) {
    return meilisearchClient.index(process.env.MEILI_INDEX || config.index).getDocuments({
        limit: 1000000,
        ...args
    });
}

export async function generateSitemaps() {
	if (process.env.SHOULD_GENERATE_SITEMAP === "true") {
		const items = await getItems()
		return Array.from({ length: Math.ceil((items.total * locales.length) / LIMIT_PER_SITEMAP) }, (_, i) => ({ id: i }))
	}
	return [];
}

export default async function sitemap({ 
	id 
}: { 
	id: number 
}): Promise<MetadataRoute.Sitemap> {
	const itemsPerLocale = Math.ceil(LIMIT_PER_SITEMAP / locales.length)
	const offset = id * itemsPerLocale
	
	const items = await getItems({
		limit: itemsPerLocale,
		offset: offset
	})

	return items.results.flatMap(item => 
		locales.map(locale => ({
			url: `${process.env.BASE_URL}/${locale}/lib/${item.key}`,
			lastModified: item.updatedAt,
			alternates: {
				languages: locales.reduce((acc, l) => ({
					...acc,
					[l]: `${process.env.BASE_URL}/${l}/lib/${item.key}`
				}), {})
			}
		}))
	)
}