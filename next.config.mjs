/** @type {import('next').NextConfig} */
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig = {
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
	},
	async rewrites() {
		return [
			{
				source: "/backend/static/:path*",
				destination: "https://us-assets.i.posthog.com/static/:path*",
			},
			{
				source: "/backend/:path*",
				destination: "https://us.i.posthog.com/:path*",
			},
			{
				source: "/images/:path*",
				destination:
					"https://ocivvlhqiwtxvnycqnia.supabase.co/storage/v1/object/public/new-kerko/:path*",
			},
		];
	},
	skipTrailingSlashRedirect: true,
};

export default withNextIntl(nextConfig);
