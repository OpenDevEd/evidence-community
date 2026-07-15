import { MetadataRoute } from "next";
import meilisearchClient from "@/lib/meilisearch";
import config from "@/constants/config.json";
import { routing } from "@/i18n/routing";
import { getSitemapPageCount } from "@/lib/sitemap";
import {
	buildLanguageAlternates,
	buildLocalizedSiteUrl,
} from "@/lib/language-alternates";
import { buildSiteUrl } from "@/lib/site-url";
import { convertToImageURL } from "@/lib/utils";
import { SITEMAP_SIZE } from "@/constants/misc";
import { getPolicyLastModified } from "@/lib/policy-documents";
import { getGapMaps } from "@/lib/gapmaps";

// Sitemap shards render per-request so MeiliSearch is queried with the
// runtime env, not the empty build env. generateSitemaps still runs at build
// to enumerate shard ids — guarded below.
export const dynamic = "force-dynamic";

export async function generateSitemaps() {
	if (!process.env.MEILISEARCH_HOST) {
		return [{ id: 0 }];
	}
	const totalPages = await getSitemapPageCount();

	return Array.from({ length: totalPages }, (_, i) => ({ id: i }));
}

export default async function sitemap(props: {
	id: Promise<number>
}): Promise<MetadataRoute.Sitemap> {
	if (!process.env.MEILISEARCH_HOST) {
		return [];
	}
	const maxRetries = 10;
	let attempt = 0;
	let items;

	const identifier = Number(await props.id);

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

	let policyEntries: MetadataRoute.Sitemap = [];
	let gapmapEntries: MetadataRoute.Sitemap = [];
	if (identifier === 0) {
		try {
			const [privacyLastModified, cookiePolicyLastModified] = await Promise.all([
				getPolicyLastModified("privacy"),
				getPolicyLastModified("cookiePolicy"),
			]);
			policyEntries = [
				{
					url: buildLocalizedSiteUrl("/privacy", routing.defaultLocale),
					lastModified: privacyLastModified,
					alternates: {
						languages: buildLanguageAlternates("/privacy"),
					},
				},
				{
					url: buildLocalizedSiteUrl("/cookie-policy", routing.defaultLocale),
					lastModified: cookiePolicyLastModified,
					alternates: {
						languages: buildLanguageAlternates("/cookie-policy"),
					},
				},
			];
		} catch {
			// Policy docs may not exist in all environments; skip gracefully.
		}

		try {
			const gapmaps = await getGapMaps();
			gapmapEntries = gapmaps.map((gm) => ({
				url: buildSiteUrl(gm.href),
			}));
		} catch {
			// Gap maps may not exist in all environments; skip gracefully.
		}
	}

	const itemEntries = items.results.map((item: any) => ({
		url: buildLocalizedSiteUrl(`/lib/${item.key}`, routing.defaultLocale),
		lastModified: item.updatedAt,
		alternates: {
			languages: buildLanguageAlternates(`/lib/${item.key}`),
		},
		images: item.attachmentsData
			?.filter((attachment: any) => attachment.PDFCoverPageImage)
			.map((attachment: any) => convertToImageURL(attachment.PDFCoverPageImage)),
	}));

	return [...policyEntries, ...gapmapEntries, ...itemEntries];
}
