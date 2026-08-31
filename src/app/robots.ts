import type { MetadataRoute } from "next";
import { buildSiteUrl } from "@/lib/site-url";

const NON_PUBLIC_PATHS = ["/api/", "/_next/", "/privacy", "/cookie-policy"];

// These provider tokens are explicitly documented as training or bulk-corpus
// crawlers. Google-Extended is also used for Gemini grounding; Google does not
// offer a narrower training-only opt-out.
const TRAINING_CRAWLERS = [
	"GPTBot",
	"ClaudeBot",
	"meta-externalagent",
	"Amazonbot",
	"CCBot",
	"Google-Extended",
	"Applebot-Extended",
];

// These agents surface sources in assistant search or fetch on a user's behalf.
const AI_SEARCH_AND_USER_AGENTS = [
	"OAI-SearchBot",
	"ChatGPT-User",
	"Claude-SearchBot",
	"Claude-User",
	"PerplexityBot",
	"Perplexity-User",
	"Meta-WebIndexer",
	"Meta-ExternalFetcher",
	"Amzn-SearchBot",
	"Amzn-User",
	"Google-Agent",
	"Google-GeminiNotebook",
	"Google-CloudVertexBot",
];

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: TRAINING_CRAWLERS,
				disallow: "/",
			},
			{
				userAgent: AI_SEARCH_AND_USER_AGENTS,
				allow: "/",
				disallow: NON_PUBLIC_PATHS,
			},
			{
				userAgent: "*",
				allow: "/",
				disallow: NON_PUBLIC_PATHS,
			},
		],
		sitemap: buildSiteUrl("/sitemap.xml"),
	};
}
