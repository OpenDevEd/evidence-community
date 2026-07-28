import Providers from "@/context/Providers";
import { FiltersProvider } from "@/context/FiltersProvider";
import Navbar from "@/components/layout/navbar";
import Footer from "@/components/layout/Footer";
import { getMessages, getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { getLangDir } from "rtl-detect";
import { getCachedStatus } from "@/app/api/cache";
import MainWrapper from "./MainWrapper";
import Banner from "./Banner";
import { Suspense } from "react";
import Script from "next/script";
import { connection } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { LibraryConfigProvider } from "@/context/LibraryConfigProvider";
import { LibraryLogoStyles } from "@/components/library/LibraryLogoStyles";
import { LibraryThemeStyles } from "@/components/library/LibraryThemeStyles";
import type { LibraryPublicConfig } from "@/config/library-config/schema";

async function BaseContent({
	children,
	gapmaps,
	locale,
}: Readonly<{
	children: React.ReactNode;
	gapmaps: LibraryPublicConfig["gapMaps"];
	locale: string;
}>) {
	const [status, messages, t] = await Promise.all([
		getCachedStatus(),
		getMessages(),
		getTranslations({ locale, namespace: "ui" }),
	]);

	return (
		<NextIntlClientProvider messages={messages}>
			<Providers
				status={status}
				gapmaps={gapmaps}
			>
				{/* Single shared filter state for the whole app — lives above the
				    navbar AND the page so collections/params stay resident across
				    navigation (no chip flash, no duplicate fetches). */}
				<FiltersProvider>
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
					<div className="flex-1 w-full flex flex-col items-center">
						{children}
					</div>
					<Footer />
					<Banner />
				</MainWrapper>
				</FiltersProvider>
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
	await connection();
	const libraryConfig = projectPublicLibraryConfig(
		await getLibraryConfig(),
	);
	const dir = getLangDir(locale);
	const googleAnalyticsId =
		libraryConfig.analytics.google.measurementId;

	return (
		<html lang={locale} dir={dir} suppressHydrationWarning>
			<head>
				<link rel="unapi-server" type="application/xml" title="unAPI" href="/api/unapi" />
				<LibraryLogoStyles identity={libraryConfig.identity} />
				<LibraryThemeStyles theme={libraryConfig.theme} />
			</head>
			<body>
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
					<LibraryConfigProvider config={libraryConfig}>
						<BaseContent
							gapmaps={libraryConfig.gapMaps}
							locale={locale}
						>
							{children}
						</BaseContent>
					</LibraryConfigProvider>
				</Suspense>
			</body>
		</html>
	);
}
