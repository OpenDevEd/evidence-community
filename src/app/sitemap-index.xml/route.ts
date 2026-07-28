import { getSitemapPageCount, getSitemapShardUrl } from "@/lib/sitemap";
import { getLibraryConfig } from "@/config/library-config/server";
import { connection } from "next/server";

function buildSitemapIndex(urls: string[]) {
	const entries = urls
		.map((url) => `  <sitemap><loc>${url}</loc></sitemap>`)
		.join("\n");

	return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`;
}

export async function GET() {
	await connection();
	const libraryConfig = await getLibraryConfig();
	if (!libraryConfig.generation.sitemap) {
		return new Response("Not Found", { status: 404 });
	}

	const totalPages = await getSitemapPageCount(libraryConfig);
	const urls = Array.from({ length: totalPages }, (_, i) =>
		getSitemapShardUrl(i, libraryConfig.identity.baseUrl)
	);

	return new Response(buildSitemapIndex(urls), {
		headers: {
			"Content-Type": "application/xml",
		},
	});
}
