import Providers from "@/context/Providers";
import { Montserrat, Ubuntu } from "next/font/google";
import Navbar from "@/components/layout/navbar";
import Footer from "@/components/layout/Footer";
import { style } from "@/../tailwind.config";
import { getMessages, getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { getLangDir } from "rtl-detect";
import { getCachedStatus } from "@/app/api/cache";
import { getGapMaps } from "@/lib/gapmaps";
import MainWrapper from "./MainWrapper";
import Banner from "./Banner";
import { Suspense } from "react";
import Script from "next/script";
import { getServerFeatureFlags } from "@/lib/server-feature-flags";

const ubuntu = Ubuntu({
	subsets: ["latin"],
	weight: ["300", "400", "500", "700"],
	variable: "--font-ubuntu",
});

const montserrat = Montserrat({
	subsets: ["latin"],
	weight: ["300", "400", "500", "700"],
	variable: "--font-montserrat",
});

async function BaseContent({
	children,
	locale,
}: Readonly<{
	children: React.ReactNode;
	locale: string;
}>) {
	const [status, messages, t, gapmaps] = await Promise.all([
		getCachedStatus(),
		getMessages(),
		getTranslations({ locale, namespace: "ui" }),
		getGapMaps(),
	]);
	const googleAnalyticsId = process.env.GOOGLE_ANALYTICS_ID || "";
	const initialFeatureFlags = getServerFeatureFlags(status.companyFooter);

	return (
		<NextIntlClientProvider messages={messages}>
			<Providers
				googleAnalyticsId={googleAnalyticsId}
				status={status}
				initialFeatureFlags={initialFeatureFlags}
				gapmaps={gapmaps}
			>
				<MainWrapper>
					<nav
						aria-label={t("skipNavAriaLabel")}
						className="absolute top-0 left-0 w-64 h-0"
					>
						<a
							href="#main-content"
							className="p-4 text-center w-1 h-1 absolute top-0 left-[-999px] z-[-999] focus:z-[999] focus:left-0 opacity-0 focus:w-fit focus:h-fit focus:opacity-100"
						>
							{t("skipToContent")}
						</a>
						<a
							href="#footer"
							className="p-4 text-center w-1 h-1 absolute top-0 left-[-999px] z-[-999] focus:z-[999] focus:left-0 opacity-0 focus:w-fit focus:h-fit focus:opacity-100"
						>
							{t("skipToFooter")}
						</a>
					</nav>
					<Navbar />
					{children}
					<Footer />
					<Banner />
				</MainWrapper>
			</Providers>
		</NextIntlClientProvider>
	);
}

export default async function Base({
	children,
	locale,
}: Readonly<{
	children: React.ReactNode;
	locale: string;
}>) {
	const dir = getLangDir(locale);
	const googleAnalyticsId = process.env.GOOGLE_ANALYTICS_ID || "";

	return (
		<html lang={locale} dir={dir} suppressHydrationWarning>
			<head>
				<link rel="unapi-server" type="application/xml" title="unAPI" href="/api/unapi" />
			</head>
			<body
				className={`${
					style === "wide" ? montserrat.className : ubuntu.className
				}`}
			>
				{googleAnalyticsId ? (
					<Script id="ga-consent-default" strategy="beforeInteractive">
						{`
							window.dataLayer = window.dataLayer || [];
							window.gtag =
								window.gtag ||
								function gtag(){window.dataLayer.push(arguments);}
							window.gtag('consent', 'default', {
								analytics_storage: 'denied',
								ad_storage: 'denied',
								ad_user_data: 'denied',
								ad_personalization: 'denied',
								wait_for_update: 500
							});
						`}
					</Script>
				) : null}
				<Suspense fallback={null}>
					<BaseContent locale={locale}>{children}</BaseContent>
				</Suspense>
			</body>
		</html>
	);
}
