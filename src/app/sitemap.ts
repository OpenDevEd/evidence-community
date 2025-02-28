import meilisearchClient from "@/lib/meilisearch";
import { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import config from "@/constants/config.json";

function getItems(
	args: {
		[key: string]: any;
	} = {}
) {
	return meilisearchClient
		.index(process.env.MEILI_INDEX || config.index)
		.getDocuments({
			limit: 1000000,
			fields: ["key", "updatedAt", "attachmentsData.PDFCoverPageImage", "attachmentsData.title"],
			...args,
		});
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const items = await getItems();

	return items.results.flatMap((item: any) => ({
		url: `${process.env.BASE_URL}/lib/${item.key}`,
		lastModified: item.updatedAt,
		alternates: {
			languages: Object.fromEntries(
				routing.locales.map((locale) => [
					locale,
					`${process.env.BASE_URL}/${locale}/lib/${item.key}`,
				])
			),
		},
		images: item.attachmentsData
			?.filter((attachment: any) => attachment.PDFCoverPageImage)
			.map((attachment: any) => process.env.BASE_URL + "/images/" + attachment.PDFCoverPageImage.split("/").slice(8).join("/")),
	}));
}

