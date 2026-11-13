import { MetadataRoute } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDatabaseForConfig } from "@/db";
import { buildSitemapKeysQuery } from "@/lib/library-export-records";
import { searchKeys } from "@/lib/search";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { getSitemapPageCount } from "@/lib/sitemap";
import { listDigestAddresses } from "@/lib/notifications/public";
import {
	buildLanguageAlternates,
	buildLocalizedSiteUrl,
} from "@/lib/language-alternates";
import { buildSiteUrl } from "@/lib/site-url";
import { convertToImageURL } from "@/lib/utils";
import { SITEMAP_SIZE } from "@/constants/misc";
import { getEnabledGapMaps } from "@/config/library-config/gap-maps";
import { loadPolicyDocument } from "@/lib/policy-documents";
import { POLICY_DESTINATIONS } from "@/lib/legal-links";

export async function generateSitemaps() {
	if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) {
		return [{ id: 0 }];
	}

	const libraryConfig = await getLibraryConfig();
	if (!libraryConfig.generation.sitemap) {
		return [];
	}

	const totalPages = await getSitemapPageCount(libraryConfig);

	return Array.from({ length: totalPages }, (_, i) => ({ id: i }));
}

/**
 * One sitemap's records with what their entries show. PostgreSQL decides which records each sitemap holds (public ones
 * with an abstract, in key order); the search copy adds their cover images. A failed search is tried again, waiting longer each time.
 */
async function readSitemapRecords(libraryConfig: LibraryServerConfig, identifier: number) {
	const keys = (await buildSitemapKeysQuery(await getDatabaseForConfig(libraryConfig), libraryConfig, SITEMAP_SIZE, identifier * SITEMAP_SIZE)).map((row) => row.key);
	if (keys.length === 0) return [];
	const maxRetries = 10;
	for (let attempt = 1; ; attempt++) {
		try {
			const response = await searchKeys(libraryConfig, keys, { number: 1, size: keys.length }, {
				exactTotal: false,
				returned: { only: ["key", "updatedAt", "attachmentsData.PDFCoverPageImage", "attachmentsData.title"] },
			});
			return response.hits;
		} catch (error) {
			if (attempt === maxRetries) {
				console.error(`Failed to fetch documents after ${maxRetries} attempts:`, error);
				throw error;
			}
			await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
		}
	}
}

export default async function sitemap(props: {
	id: Promise<number>
}): Promise<MetadataRoute.Sitemap> {
	// Resolve the active library and its documents at request time.
	await connection();

	const identifier = Number(await props.id);
	const libraryConfig = await getLibraryConfig();
	if (!libraryConfig.generation.sitemap) {
		notFound();
	}

	const { localization } = libraryConfig;
	const baseUrl = libraryConfig.identity.baseUrl;
	const records = await readSitemapRecords(libraryConfig, identifier);

	let pageEntries: MetadataRoute.Sitemap = [];
	if (identifier === 0) {
		// The home is listed only while it is a page of its own; otherwise `/` is a redirect to the listing.
		const pages = isLibraryFeatureEnabled(libraryConfig.features, "homePage") ? ["/", "/lib"] : ["/lib"];
		// Of the policy pages only the terms are listed: robots.txt keeps search engines off the privacy and cookie pages.
		const terms = await loadPolicyDocument(libraryConfig, "terms").catch(() => null);
		const page = (pathname: string, lastModified?: string | Date) => ({
			url: buildLocalizedSiteUrl(pathname, localization.defaultLocale, localization, baseUrl),
			lastModified,
			alternates: { languages: buildLanguageAlternates(pathname, localization, baseUrl) },
		});
		// The digests are the community's own writing: the archive, then each edition at its one address.
		const editions = await listDigestAddresses(await getDatabaseForConfig(libraryConfig));
		pageEntries = [
			...pages.map((pathname) => page(pathname)),
			...(terms ? [page(POLICY_DESTINATIONS.terms.path, terms.lastUpdated)] : []),
			...getEnabledGapMaps(libraryConfig.gapMaps).map((gapMap) => ({ url: buildSiteUrl(gapMap.href, baseUrl) })),
			// The archive is also where readers subscribe, so it is listed before the first edition goes out.
			...(editions.length || libraryConfig.notifications.enabled ? [page("/digests", editions[0]?.publishedAt)] : []),
			...editions.map(({ slug, publishedAt }) => ({ url: buildSiteUrl(`/digests/${slug}`, baseUrl), lastModified: publishedAt })),
		];
	}

	const itemEntries = records.map((item: any) => ({
		url: buildLocalizedSiteUrl(
				`/lib/${item.key}`,
				localization.defaultLocale,
				localization,
				baseUrl,
		),
		lastModified: item.updatedAt,
		// No language alternates: every language version of a record names this address as canonical.
		images: item.attachmentsData
			?.filter((attachment: any) => attachment.PDFCoverPageImage)
				.map((attachment: any) =>
					convertToImageURL(
						attachment.PDFCoverPageImage,
					)
				),
	}));

	return [...pageEntries, ...itemEntries];
}
