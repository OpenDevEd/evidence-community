/** @type {import('next').NextConfig} */
import { availableParallelism } from "node:os";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig = {
	allowedDevOrigins: ["127.0.0.1"],
	cacheComponents: true,
	serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
	typescript: {
		ignoreBuildErrors:
			process.env.EVIDENCE_LIBRARY_RELEASE_BUILD === "1",
	},
	experimental: {
		cpus: Math.max(1, availableParallelism() - 1),
		turbopackFileSystemCacheForBuild: true,
		workerThreads: true,
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
