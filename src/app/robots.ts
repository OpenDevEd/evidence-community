import type { MetadataRoute } from "next";
import { buildSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: ["/api/", "/_next/", "/privacy", "/cookie-policy"],
			},
		],
		sitemap: buildSiteUrl("/sitemap.xml"),
	};
}
