/** @type {import('next').NextConfig} */
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig = {
	cacheComponents: true,
	env: {
		NEXT_PUBLIC_CANONICAL_BASE_URL:
			process.env.NEXT_PUBLIC_CANONICAL_BASE_URL ?? process.env.BASE_URL ?? "",
	},
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
		return {
			beforeFiles: [],
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
			fallback: [],
		};
	},
	skipTrailingSlashRedirect: true,
};

export default withNextIntl(nextConfig);
