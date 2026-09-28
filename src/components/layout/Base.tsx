import Providers from "@/context/Providers";
import { FiltersProvider } from "@/context/FiltersProvider";
import { getMessages, getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { getLangDir } from "rtl-detect";
import { getCachedStatus } from "@/app/api/cache";
import MainWrapper from "./MainWrapper";
import SiteChrome from "./SiteChrome";
import ConsentDefaultsScript from "@/app/_components/ConsentDefaultsScript";
import { getLibraryConfig } from "@/config/library-config/server";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { LibraryConfigProvider } from "@/context/LibraryConfigProvider";
import { cookies } from "next/headers";

import { ANALYTICS_CONSENT_COOKIE_NAME } from "@/lib/analytics-consent";
import { LibraryLogoStyles } from "@/components/library/LibraryLogoStyles";
import { LibraryThemeStyles } from "@/components/library/LibraryThemeStyles";
import type { LibraryPublicConfig } from "@/config/library-config/schema";

async function BaseContent({
	children,
	gapmaps,
	locale,
	storedConsent,
}: Readonly<{
	children: React.ReactNode;
	gapmaps: LibraryPublicConfig["gapMaps"];
	locale: string;
	storedConsent: string | null;
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
				storedConsent={storedConsent}
			>
				{/* Single shared filter state for the whole app — lives above the
				    navbar AND the page so collections/params stay resident across
				    navigation (no chip flash, no duplicate fetches). */}
				<FiltersProvider>
					<MainWrapper>
						<SiteChrome
							skipNavigationLabel={t("skipNavAriaLabel")}
							skipToContentLabel={t("skipToContent")}
							skipToFooterLabel={t("skipToFooter")}
						>
							{children}
						</SiteChrome>
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
	// Reading the reader's stored answer is a request-time read, so these
	// pages are drawn per request and the runtime settings below are never
	// baked into a build. That is what the earlier `connection()` call was
	// for, so it is gone.
	const storedConsent =
		(await cookies()).get(ANALYTICS_CONSENT_COOKIE_NAME)?.value ?? null;
	const libraryConfig = projectPublicLibraryConfig(await getLibraryConfig());
	const dir = getLangDir(locale);
	return (
		<html lang={locale} dir={dir} className="no-scrollbar" suppressHydrationWarning>
			<body>
				<ConsentDefaultsScript />
				<link
					rel="unapi-server"
					type="application/xml"
					title="unAPI"
					href="/api/unapi"
				/>
				<LibraryLogoStyles identity={libraryConfig.identity} />
				<LibraryThemeStyles theme={libraryConfig.theme} />
				{/*
				 * No Suspense around the whole page. Next first renders a
				 * segment from its prerendered data, then again from the full
				 * data. If a boundary here is still streaming at that moment,
				 * React drops its server HTML and draws the page again on the
				 * client, which blanks the page and loses clicks. Under load
				 * that happened on about one admin load in ten.
				 */}
				<LibraryConfigProvider config={libraryConfig}>
					<BaseContent
						gapmaps={libraryConfig.gapMaps}
						locale={locale}
						storedConsent={storedConsent}
					>
						{children}
					</BaseContent>
				</LibraryConfigProvider>
			</body>
		</html>
	);
}
