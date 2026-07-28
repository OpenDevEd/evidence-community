import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { buildSiteUrl } from "@/lib/site-url";

export default async function robots(): Promise<MetadataRoute.Robots> {
	await connection();
	const libraryConfig = await getLibraryConfig();

	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: ["/api/", "/_next/", "/privacy", "/cookie-policy"],
			},
		],
		...(libraryConfig.generation.sitemap
			? {
					sitemap: buildSiteUrl(
						"/sitemap.xml",
						libraryConfig.identity.baseUrl,
					),
				}
			: {}),
	};
}
