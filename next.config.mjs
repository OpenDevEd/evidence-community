/** @type {import('next').NextConfig} */
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig = {
	cacheComponents: true,
	experimental: {
		staleTimes: {
			dynamic: 30,
		},
	},
	reactCompiler: true,
	images: {
		// Runtime configuration can reference any public asset host. Serving
		// source URLs directly keeps one image build valid for every library.
		unoptimized: true,
	},
	async rewrites() {
		return {
			beforeFiles: [],
			afterFiles: [
				{
					source: "/sitemap.xml",
					destination: "/sitemap-index.xml",
				},
			],
			fallback: [],
		};
	},
	skipTrailingSlashRedirect: true,
};

export default withNextIntl(nextConfig);
