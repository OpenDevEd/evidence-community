/** @type {import('next').NextConfig} */
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig = {
	experimental: {
		reactCompiler: true,
		staleTimes: {
			dynamic: 30,
		},
	},
	images: {
		remotePatterns: [
			{ hostname: "tlxvwvgyaanqlmuyoguz.supabase.co" },
			{ hostname: "lh3.googleusercontent.com" },
			{ hostname: "ocivvlhqiwtxvnycqnia.supabase.co" },
		],
	},
	async rewrites() {
		return [
			{
				source: "/ingest/static/:path*",
				destination: "https://us-assets.i.posthog.com/static/:path*",
			},
			{
				source: "/ingest/:path*",
				destination: "https://us.i.posthog.com/:path*",
			},
			{
				source: "/ingest/decide",
				destination: "https://us.i.posthog.com/decide",
			},
		];
	},
	skipTrailingSlashRedirect: true,
};

export default withNextIntl(nextConfig);
