import { connection } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";

/**
 * The site's name for search results: Google reads `WebSite` markup on the home page to name a site above its results.
 * Drawn on the home page and on the listing, which is the home when the library has no home page.
 */
export default async function SiteStructuredData() {
	await connection();
	const { identity } = await getLibraryConfig();
	const site = {
		"@context": "https://schema.org",
		"@type": "WebSite",
		name: identity.name,
		...(identity.shortName && identity.shortName !== identity.name ? { alternateName: identity.shortName } : {}),
		url: new URL("/", identity.baseUrl).href,
	};
	// `<` escaped, so a name can't close the script.
	return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(site).replace(/</g, "\\u003c") }} />;
}
