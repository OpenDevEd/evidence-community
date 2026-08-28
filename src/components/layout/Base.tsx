import Providers from "@/context/Providers";
import { FiltersProvider } from "@/context/FiltersProvider";
import { getMessages, getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { getLangDir } from "rtl-detect";
import { getCachedStatus } from "@/app/api/cache";
import MainWrapper from "./MainWrapper";
import SiteChrome from "./SiteChrome";
import { Suspense } from "react";
import { connection } from "next/server";
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
	await connection();
	// The pages here are already drawn per request, so reading the reader's
	// stored answer costs nothing and lets the first drawing know it.
	const storedConsent =
		(await cookies()).get(ANALYTICS_CONSENT_COOKIE_NAME)?.value ?? null;
	const libraryConfig = projectPublicLibraryConfig(await getLibraryConfig());
	const dir = getLangDir(locale);
	return (
		<html lang={locale} dir={dir} suppressHydrationWarning>
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
				<Suspense fallback={null}>
					<LibraryConfigProvider config={libraryConfig}>
						<BaseContent
							gapmaps={libraryConfig.gapMaps}
							locale={locale}
							storedConsent={storedConsent}
						>
							{children}
						</BaseContent>
					</LibraryConfigProvider>
				</Suspense>
			</body>
		</html>
	);
}
