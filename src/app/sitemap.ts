import type { MetadataRoute } from "next";
import meilisearchClient from "@/lib/meilisearch";
import config from "@/constants/config.json";
import { Locale, getPathname, routing } from '@/i18n/routing';

type Href = Parameters<typeof getPathname>[0]['href'];

function getUrl(href: Href, locale: Locale) {
    const pathname = getPathname({ locale, href });
    return `${process.env.BASE_URL || config.baseURL}${pathname}`;
}

function getEntry(href: Href, lastModified: Date = new Date()) {
    return {
        url: getUrl(href, routing.defaultLocale),
        lastModified,
        alternates: {
            languages: Object.fromEntries(
                routing.locales.map((locale) => [locale, getUrl(href, locale)])
            )
        }
    };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const documents = await meilisearchClient.index(process.env.MEILI_INDEX || config.index).getDocuments({
        limit: 1000000,
    });

    const baseEntries = [
        getEntry('/'),
        getEntry('/lib')
    ];

    const documentEntries = documents.results.map((item) => 
        getEntry(`/lib/${item.key}`, new Date(item.updatedAt))
    );

    return [
        ...baseEntries,
        ...documentEntries
    ];
}