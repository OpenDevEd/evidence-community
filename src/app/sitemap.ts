import { MetadataRoute } from "next";
import meilisearchClient from "@/lib/meilisearch";
import config from "@/constants/config.json";
import { routing } from "@/i18n/routing";
import { getSitemapPageCount } from "@/lib/sitemap";
import { buildSiteUrl } from "@/lib/site-url";
import { convertToImageURL } from "@/lib/utils";
import { SITEMAP_SIZE } from "@/constants/misc";
import { getPolicyLastModified } from "@/lib/policy-documents";

function getLocalizedUrl(pathname: string, locale: string) {
	const localizedPath =
		locale === routing.defaultLocale ? pathname : `/${locale}${pathname}`;

	return buildSiteUrl(localizedPath);
}

function getLanguageAlternates(pathname: string) {
	return Object.fromEntries(
		routing.locales.map((locale) => [locale, getLocalizedUrl(pathname, locale)])
	);
}

export async function generateSitemaps() {
	const totalPages = await getSitemapPageCount();

	return Array.from({ length: totalPages }, (_, i) => ({ id: i }));
}

export default async function sitemap(props: {
	id: Promise<number>
}): Promise<MetadataRoute.Sitemap> {
	const maxRetries = 10;
	let attempt = 0;
	let items;

	const identifier = await props.id;

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

	const policyEntries =
		identifier === 0
			? await Promise.all([
					getPolicyLastModified("privacy"),
					getPolicyLastModified("cookiePolicy"),
			  ]).then(([privacyLastModified, cookiePolicyLastModified]) => [
					{
						url: getLocalizedUrl("/privacy", routing.defaultLocale),
						lastModified: privacyLastModified,
						alternates: {
							languages: getLanguageAlternates("/privacy"),
						},
					},
					{
						url: getLocalizedUrl(
							"/cookie-policy",
							routing.defaultLocale
						),
						lastModified: cookiePolicyLastModified,
						alternates: {
							languages: getLanguageAlternates("/cookie-policy"),
						},
					},
			  ])
			: [];

	const itemEntries = items.results.map((item: any) => ({
		url: getLocalizedUrl(`/lib/${item.key}`, routing.defaultLocale),
		lastModified: item.updatedAt,
		alternates: {
			languages: getLanguageAlternates(`/lib/${item.key}`),
		},
		images: item.attachmentsData
			?.filter((attachment: any) => attachment.PDFCoverPageImage)
			.map((attachment: any) => convertToImageURL(attachment.PDFCoverPageImage)),
	}));

	return [...policyEntries, ...itemEntries];
}
