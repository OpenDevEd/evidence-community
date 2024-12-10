/** @type {import('next').NextConfig} */
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig = {
	images: {
		remotePatterns: [{ hostname: 'tlxvwvgyaanqlmuyoguz.supabase.co' }],
	},
};

export default withNextIntl(nextConfig);
