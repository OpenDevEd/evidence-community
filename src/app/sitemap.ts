import type { MetadataRoute } from "next";
import meilisearchClient from "@/lib/meilisearch";
import config from "@/constants/config.json"

const baseSiteMap: MetadataRoute.Sitemap = [
    {
        url: `${process.env.BASE_URL}`,
        lastModified: new Date(),
    },
    {
        url: `${process.env.BASE_URL}/lib`,
        lastModified: new Date(),
    }
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const documents = await meilisearchClient.index(process.env.MEILI_INDEX || config.index).getDocuments({
        limit: 1000000,
    })

    return [...baseSiteMap, ...documents.results.map((item) => ({
        url: `${process.env.BASE_URL || config.baseURL}/lib/${item.key}`,
        lastModified: new Date(item.updatedAt),
    }))]
}