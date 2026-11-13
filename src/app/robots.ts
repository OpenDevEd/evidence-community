import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { buildSiteUrl } from "@/lib/site-url";

/**
 * Crawlers that collect pages to train AI models, as Openscholar lists them (`lib/seo/training-crawlers.ts` in
 * openalex-count). The shield in front of every community already refuses them, so naming them here stops them asking.
 * Search and answer bots (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-User) aren't here: they may read everything.
 */
const TRAINING_CRAWLERS = [
	"Amazonbot", "Applebot-Extended", "Bytespider", "CCBot", "ClaudeBot", "Diffbot", "Google-Extended", "GPTBot", "omgili",
	"anthropic-ai", "Claude-Web", "cohere-ai", "MistralAI-Training", "meta-externalagent", "GoogleOther", "AwarioSmartBot",
	"AwarioRssBot", "Google-CloudVertexBot", "QualifiedBot", "Cotoyogi", "ICC-Crawler", "atlassian-bot", "FishBot",
	"BorderxBot", "NavuBot", "SemrushBot-SWA", "WARDBot", "magpie-crawler", "KimiBot", "CitibotSiteCrawler",
];

export default async function robots(): Promise<MetadataRoute.Robots> {
	await connection();
	const libraryConfig = await getLibraryConfig();

	return {
		rules: [
			{ userAgent: TRAINING_CRAWLERS, disallow: "/" },
			{
				userAgent: "*",
				// `/_next/` holds every page's scripts, styles and fonts, which a search engine needs to draw the page, and
				// the image optimizer, whose addresses carry a query. The longer rule wins, so it stays open under `/*?`.
				allow: ["/", "/_next/"],
				disallow: [
					"/api/",
					"/privacy",
					"/cookie-policy",
					// An address with a query repeats a page that has its own, or lists records the sitemap and the browse
					// pages already reach: a filtered, sorted or numbered list, a record opened from a list. Search engines
					// spend their visits on records instead.
					"/*?",
					// A record's citation page and citation files repeat the record.
					"/citation/",
					"/*/citation/",
					"/*/export/",
				],
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
