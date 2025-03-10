import { MetadataRoute } from "next";
import meilisearchClient from "@/lib/meilisearch";
import config from "@/constants/config.json";
import { routing } from "@/i18n/routing";
import { convertToImageURL } from "@/lib/utils";
import { SITEMAP_SIZE } from "@/constants/misc";
import { getTotalItems } from "@/lib/actions";

export async function generateSitemaps() {
	const total = await getTotalItems();
	const totalPages = Math.ceil(total / SITEMAP_SIZE);

	console.log("\ntotalItems:", total);
	console.log("totalSitemaps:\n", totalPages);

	return Array.from({ length: totalPages }, (_, i) => ({ id: i }));
}

export default async function sitemap({
	id,
}: {
	id: number
}): Promise<MetadataRoute.Sitemap> {
	const maxRetries = 10;
	let attempt = 0;
	let items;

	const identifier = Number(id);

	console.log(`fetching the page id ${identifier}`);

	while (attempt < maxRetries) {
		try {
			items = await meilisearchClient.index(process.env.MEILI_INDEX || config.index).getDocuments({
				limit: SITEMAP_SIZE,
				fields: ["key", "updatedAt", "attachmentsData.PDFCoverPageImage", "attachmentsData.title"],
				offset: identifier * SITEMAP_SIZE,
			});
			break; // Success - exit the loop
		} catch (error) {
			attempt++;
			if (attempt === maxRetries) {
				console.error(`Failed to fetch documents after ${maxRetries} attempts:`, error);
				throw error; // Re-throw if all retries failed
			}
			// Wait for 1 second before retrying (exponential backoff)
			await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
		}
	}

	if (!items) {
		return [];
	}


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
			.map((attachment: any) => convertToImageURL(attachment.PDFCoverPageImage)),
	}));
}
