import { getSitemapPageCount, getSitemapShardUrl } from "@/lib/sitemap";

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
	const totalPages = await getSitemapPageCount();
	const urls = Array.from({ length: totalPages }, (_, i) =>
		getSitemapShardUrl(i)
	);

	return new Response(buildSitemapIndex(urls), {
		headers: {
			"Content-Type": "application/xml",
		},
	});
}
