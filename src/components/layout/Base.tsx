import Providers from "@/context/Providers";
import { AskAboutHost } from "@/components/features/ai/AskAboutHost";
import { FiltersProvider } from "@/context/FiltersProvider";
import { getMessages, getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { getLangDir } from "rtl-detect";
import { getCachedStatus } from "@/app/api/cache";
import MainWrapper from "./MainWrapper";
import SiteChrome from "./SiteChrome";
import { Suspense } from "react";
import ConsentDefaultsScript from "@/app/_components/ConsentDefaultsScript";
import EarlyTypingScript from "@/app/_components/EarlyTypingScript";
import { getLibraryConfig } from "@/config/library-config/server";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { LibraryConfigProvider } from "@/context/LibraryConfigProvider";
import { cookies, headers } from "next/headers";

import { analyticsConsentCookieNames, analyticsConsentPolicy } from "@/lib/analytics-consent";
import { LibraryLogoStyles } from "@/components/library/LibraryLogoStyles";
import { LibraryThemeStyles, themeGoogleFonts } from "@/components/library/LibraryThemeStyles";
import { PLATFORM_FONTS } from "@/components/library/platform-fonts";
import { NavbarFitStyles } from "@/components/layout/navbar/NavbarFitStyles";
import type { LibraryPublicConfig } from "@/config/library-config/schema";
import { getSignedInOpenScholarUser } from "@/lib/readers/session";
import { teamStandingOf } from "@/lib/readers/join-standing";
import PageFallback, { LoadPageFallback } from "@/components/pages/PageFallback";
import { isEmailChannelEnabled } from "@/lib/nodemailer";
import { homePlaceholderContent } from "@/components/pages/HomeRichText";
import { intlLocale } from "@/i18n/intl-locale";

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
	const config = await getLibraryConfig();
	const [status, messages, t, signedIn] = await Promise.all([
		getCachedStatus(),
		getMessages(),
		getTranslations({ locale, namespace: "ui" }),
		getSignedInOpenScholarUser(await headers(), config),
	]);
	// Only what other readers may see goes to the browser, and whether they have a role here, for the menu's Admin.
	const reader = signedIn ? { id: signedIn.id, name: signedIn.name, image: signedIn.image } : null;
	const team = await teamStandingOf(config, signedIn);

	return (
		<NextIntlClientProvider messages={messages}>
			<Providers
				status={status}
				gapmaps={gapmaps}
				storedConsent={storedConsent}
				reader={reader}
				readerAdmin={team.admin}
				readerJoin={team.join}
			>
				{/* Single shared filter state for the whole app — lives above the
				    navbar AND the page so collections/params stay resident across
				    navigation (no chip flash, no duplicate fetches). */}
				<FiltersProvider>
					{/* The chat a public page opens about a publication, from a card or a link's preview. */}
					<AskAboutHost>
					<MainWrapper>
						<SiteChrome
							skipNavigationLabel={t("skipNavAriaLabel")}
							skipToContentLabel={t("skipToContent")}
							skipToFooterLabel={t("skipToFooter")}
						>
							{children}
						</SiteChrome>
					</MainWrapper>
					</AskAboutHost>
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
	const requestCookies = await cookies();
	// One configuration snapshot for the page: an activation mid-render must not
	// give the header's fit styles a different library than the header itself.
	const serverConfig = await getLibraryConfig();
	// The cookies that hold the answer, as a cookie header for the provider to read.
	const storedConsent =
		analyticsConsentCookieNames(analyticsConsentPolicy(serverConfig))
			.flatMap((name) => {
				const cookie = requestCookies.get(name);
				return cookie ? [`${name}=${encodeURIComponent(cookie.value)}`] : [];
			})
			.join("; ") || null;
	const libraryConfig = projectPublicLibraryConfig(serverConfig);
	const dir = getLangDir(locale);
	// Only the library's own fonts are set on the page, so only those are preloaded.
	const fontVariables = themeGoogleFonts(libraryConfig.theme).map((family) => PLATFORM_FONTS[family].variable);
	const fallback = { contactForm: isEmailChannelEnabled(serverConfig, "contact"), home: homePlaceholderContent(serverConfig, (await getTranslations({ locale, namespace: "homePage" }))("defaultIntro", { name: serverConfig.identity.name })) };
	return (
		<html lang={intlLocale(locale)} dir={dir} className={fontVariables.join(" ")} suppressHydrationWarning>
			<body>
				<EarlyTypingScript />
				<ConsentDefaultsScript />
				<link
					rel="unapi-server"
					type="application/xml"
					title="unAPI"
					href="/api/unapi"
				/>
				<LibraryLogoStyles identity={libraryConfig.identity} />
				<LibraryThemeStyles theme={libraryConfig.theme} />
				<NavbarFitStyles config={serverConfig} locale={locale} />
				<LibraryConfigProvider config={libraryConfig}>
					<BaseContent
						gapmaps={libraryConfig.gapMaps}
						locale={locale}
						storedConsent={storedConsent}
					>
						{/*
						 * Only the page sits in a boundary, not the providers
						 * around it. A boundary around everything was hidden and
						 * drawn again right after hydration on about one admin
						 * load in ten under load, which blanked the page and lost
						 * clicks. A page's own redirect() still needs a boundary
						 * here to reach the browser as a client-side redirect.
						 * Its fallback shows while the page is on its way: on a
						 * first load, and on Back when the page is read again.
						 */}
						<LoadPageFallback {...fallback} />
						<Suspense fallback={<PageFallback {...fallback} />}>{children}</Suspense>
					</BaseContent>
				</LibraryConfigProvider>
			</body>
		</html>
	);
}
