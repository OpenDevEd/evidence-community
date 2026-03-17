/** @type {import('next').NextConfig} */
import createNextIntlPlugin from "next-intl/plugin";
import config from "./src/constants/config.json" with { type: "json" };

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
		remotePatterns: [
			{ hostname: "tlxvwvgyaanqlmuyoguz.supabase.co" },
			{ hostname: "lh3.googleusercontent.com" },
			{ hostname: "ocivvlhqiwtxvnycqnia.supabase.co" },
			{ hostname: "flagcdn.com" },
		],
		dangerouslyAllowLocalIP: true,
	},
	async rewrites() {
		const index = process.env.MEILI_INDEX || config.index;
		return {
			beforeFiles: [
				{
					source: "/gapmaps/:slug.html",
					destination: `/gapmaps/${index}/:slug.html`,
				},
			],
			afterFiles: [
				{
					source: "/sitemap.xml",
					destination: "/sitemap-index.xml",
				},
				{
					source: "/images/:path*",
					destination:
						"https://ocivvlhqiwtxvnycqnia.supabase.co/storage/v1/object/public/new-kerko/:path*",
				},
			],
		};
	},
	skipTrailingSlashRedirect: true,
};

export default withNextIntl(nextConfig);
