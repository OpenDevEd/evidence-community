import { MetadataRoute } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { getLibraryConfig } from "@/config/library-config/server";
import { getSitemapPageCount } from "@/lib/sitemap";
import {
	buildLanguageAlternates,
	buildLocalizedSiteUrl,
} from "@/lib/language-alternates";
import { buildSiteUrl } from "@/lib/site-url";
import { convertToImageURL } from "@/lib/utils";
import { SITEMAP_SIZE } from "@/constants/misc";
import { getPolicyLastModified } from "@/lib/policy-documents";
import { getEnabledGapMaps } from "@/config/library-config/gap-maps";

// Sitemap shards render per request so both shard enumeration and document
// reads resolve the active runtime configuration revision.
export const dynamic = "force-dynamic";

export async function generateSitemaps() {
	if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) {
		return [{ id: 0 }];
	}

	const libraryConfig = await getLibraryConfig();
	const totalPages = await getSitemapPageCount(libraryConfig);

	return Array.from({ length: totalPages }, (_, i) => ({ id: i }));
}

export default async function sitemap(props: {
	id: Promise<number>
}): Promise<MetadataRoute.Sitemap> {
	const maxRetries = 10;
	let attempt = 0;
	let items;

	const identifier = Number(await props.id);
	const libraryConfig = await getLibraryConfig();
	const { localization } = libraryConfig;
	const baseUrl = libraryConfig.identity.baseUrl;
	const { index } = await getMeilisearchForConfig(libraryConfig);

	while (attempt < maxRetries) {
		try {
			items = await index.getDocuments({
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
					url: buildLocalizedSiteUrl(
							"/privacy",
							localization.defaultLocale,
							localization,
							baseUrl,
					),
					lastModified: privacyLastModified,
					alternates: {
						languages: buildLanguageAlternates(
								"/privacy",
								localization,
								baseUrl,
						),
					},
				},
				{
					url: buildLocalizedSiteUrl(
							"/cookie-policy",
							localization.defaultLocale,
							localization,
							baseUrl,
					),
					lastModified: cookiePolicyLastModified,
					alternates: {
						languages: buildLanguageAlternates(
								"/cookie-policy",
								localization,
								baseUrl,
						),
					},
				},
			];
		} catch {
			// Policy docs may not exist in all environments; skip gracefully.
		}

		gapmapEntries = getEnabledGapMaps(
			libraryConfig.gapMaps,
			).map((gapMap) => ({
				url: buildSiteUrl(gapMap.href, baseUrl),
		}));
	}

	const itemEntries = items.results.map((item: any) => ({
		url: buildLocalizedSiteUrl(
				`/lib/${item.key}`,
				localization.defaultLocale,
				localization,
				baseUrl,
		),
		lastModified: item.updatedAt,
		alternates: {
			languages: buildLanguageAlternates(
					`/lib/${item.key}`,
					localization,
					baseUrl,
			),
		},
		images: item.attachmentsData
			?.filter((attachment: any) => attachment.PDFCoverPageImage)
				.map((attachment: any) =>
					convertToImageURL(
						attachment.PDFCoverPageImage,
						baseUrl,
					)
				),
	}));

	return [...policyEntries, ...gapmapEntries, ...itemEntries];
}
