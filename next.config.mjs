import { withSentryConfig } from "@sentry/nextjs";
/** @type {import('next').NextConfig} */
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig = {
	experimental: {
		reactCompiler: true,
		staleTimes: {
			dynamic: 30,
		},
		streamingMetadata: true,
	},
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
			{
				source: "/images/:path*",
				destination:
					"https://ocivvlhqiwtxvnycqnia.supabase.co/storage/v1/object/public/new-kerko/:path*",
			},
		];
	},
	skipTrailingSlashRedirect: true,
};

export default withSentryConfig(withNextIntl(nextConfig), {
	// For all available options, see:
	// https://www.npmjs.com/package/@sentry/webpack-plugin#options

	org: "opendeved",
	project: "new-el-opendeved",

	// Only print logs for uploading source maps in CI
	silent: !process.env.CI,

	// For all available options, see:
	// https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

	// Upload a larger set of source maps for prettier stack traces (increases build time)
	widenClientFileUpload: true,

	// Automatically annotate React components to show their full name in breadcrumbs and session replay
	reactComponentAnnotation: {
		enabled: true,
	},

	// Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
	// This can increase your server load as well as your hosting bill.
	// Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
	// side errors will fail.
	tunnelRoute: "/monitoring",

	// Automatically tree-shake Sentry logger statements to reduce bundle size
	disableLogger: true,

	// Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
	// See the following for more information:
	// https://docs.sentry.io/product/crons/
	// https://vercel.com/docs/cron-jobs
	automaticVercelMonitors: true,
});
