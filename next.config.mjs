/** @type {import('next').NextConfig} */
import { availableParallelism } from "node:os";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig = {
	// ponytail: mock only, so two libraries' dev servers can run from one checkout.
	distDir: process.env.NEXT_DIST_DIR || ".next",
	allowedDevOrigins: ["127.0.0.1"],
	cacheComponents: true,
	// Cached item pages: about 8,000 records at roughly 12 KB each is 96 MB.
	cacheMaxMemorySize: 128 * 1024 * 1024,
	serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "citeproc-ts"],
	typescript: {
		ignoreBuildErrors: process.env.SKIP_BUILD_TYPECHECK === "1",
	},
	experimental: {
		cpus: Math.max(1, availableParallelism() - 1),
		turbopackFileSystemCacheForBuild: true,
		workerThreads: true,
	},
	reactCompiler: true,
	images: {
		// Covers and the library's logo reach the optimizer through /covers and
		// /brand (see CoverImage and LibraryIdentity). Every other image is marked
		// unoptimized: runtime configuration can reference any public asset host,
		// so one image build stays valid for every library.
		// No query string, so each file has one optimized copy per size.
		localPatterns: [{ pathname: "/covers/**", search: "" }, { pathname: "/brand/**", search: "" }],
		// Next's steps plus 512, so a cover drawn about 200 px wide on a 2x screen is not sent at 640.
		imageSizes: [32, 48, 64, 96, 128, 256, 384, 512],
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
