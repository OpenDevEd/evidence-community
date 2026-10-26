import { MetadataRoute } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDatabaseForConfig } from "@/db";
import { buildPublicLibraryKeysQuery } from "@/lib/library-export-records";
import { searchKeys } from "@/lib/search";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { getSitemapPageCount } from "@/lib/sitemap";
import {
	buildLanguageAlternates,
	buildLocalizedSiteUrl,
} from "@/lib/language-alternates";
import { buildSiteUrl } from "@/lib/site-url";
import { convertToImageURL } from "@/lib/utils";
import { SITEMAP_SIZE } from "@/constants/misc";
import { loadPolicyDocument } from "@/lib/policy-documents";
import { POLICY_DESTINATIONS, type PolicyDocumentKind } from "@/lib/legal-links";
import { getEnabledGapMaps } from "@/config/library-config/gap-maps";

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
 * One sitemap's records with what their entries show. PostgreSQL decides which records each sitemap holds, in key
 * order; the search copy adds their cover images. A failed search is tried again, waiting longer each time.
 */
async function readSitemapRecords(libraryConfig: LibraryServerConfig, identifier: number) {
	const keys = (await buildPublicLibraryKeysQuery(await getDatabaseForConfig(libraryConfig), libraryConfig, SITEMAP_SIZE, identifier * SITEMAP_SIZE)).map((row) => row.key);
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

	let policyEntries: MetadataRoute.Sitemap = [];
	let gapmapEntries: MetadataRoute.Sitemap = [];
	let homeEntries: MetadataRoute.Sitemap = [];
	if (identifier === 0) {
		// Listed only while it is a page of its own; otherwise `/` is a redirect to the listing.
		if (isLibraryFeatureEnabled(libraryConfig.features, "homePage")) {
			homeEntries = [{
				url: buildLocalizedSiteUrl("/", localization.defaultLocale, localization, baseUrl),
				alternates: { languages: buildLanguageAlternates("/", localization, baseUrl) },
			}];
		}
		const policyPages = Object.entries(POLICY_DESTINATIONS) as [PolicyDocumentKind, (typeof POLICY_DESTINATIONS)[PolicyDocumentKind]][];
		try {
			const documents = await Promise.all(
				policyPages.map(([kind]) => loadPolicyDocument(libraryConfig, kind)),
			);
			policyEntries = policyPages.flatMap(([, { path: pathname }], index) => {
				const document = documents[index];
				if (!document) return [];
				return [
					{
						url: buildLocalizedSiteUrl(
							pathname,
							localization.defaultLocale,
							localization,
							baseUrl,
						),
						lastModified: document.lastUpdated,
						alternates: {
							languages: buildLanguageAlternates(
								pathname,
								localization,
								baseUrl,
							),
						},
					},
				];
			});
		} catch {
			// Policy docs may not exist in all environments; skip gracefully.
		}

		gapmapEntries = getEnabledGapMaps(
			libraryConfig.gapMaps,
			).map((gapMap) => ({
				url: buildSiteUrl(gapMap.href, baseUrl),
		}));
	}

	const itemEntries = records.map((item: any) => ({
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
					)
				),
	}));

	return [...homeEntries, ...policyEntries, ...gapmapEntries, ...itemEntries];
}
