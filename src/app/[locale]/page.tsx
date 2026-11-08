import HomePage from "@/components/pages/HomePage";
import { tonesFrom } from "@/components/pages/home-tones";
import { getWorldMap } from "@/components/pages/home-map-shapes";
import { contentFrom, defaultContent } from "@/components/pages/home-content";
import { loadHomeData } from "@/components/pages/home-data";
import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import { getLibraryConfig } from "@/config/library-config/server";
import { getRuntimePageAvailability } from "@/config/library-config/pages";
import { redirect } from "@/i18n/routing";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { homeRich } from "@/components/pages/HomeRichText";
import { buildLanguageAlternates, buildLocalizedSiteUrl } from "@/lib/language-alternates";

// The library's home page, shown at `/` while `features.homePage` is on; otherwise `/` opens the listing.

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	await connection();
	const config = await getLibraryConfig();
	const { locale } = await params;
	const { description, name, tagline, baseUrl } = config.identity;
	return {
		// The tagline tells search engines what the library holds.
		title: tagline?.trim() ? `${name}: ${tagline.trim()}` : name,
		description: description?.trim() || tagline?.trim() || name,
		// Each language's home is its own page, as each language's listing is.
		alternates: {
			canonical: buildLocalizedSiteUrl("/", locale as typeof config.localization.defaultLocale, config.localization, baseUrl),
			languages: buildLanguageAlternates("/", config.localization, baseUrl),
		},
	};
}

// No loading boundary: the page waits only for the library settings, so the first response is the finished page
// rather than a spinner; the figures stream in behind it.
// Next.js reads this route export. Fallow does not recognize it yet.
// fallow-ignore-next-line unused-export
export const instant = false;

export default async function Home({ params }: Props) {
	await connection();
	const config = await getLibraryConfig();
	// The proxy already sends a bare `/` to the listing; this covers the address with a locale in front, which reaches the page.
	if (!isLibraryFeatureEnabled(config.features, "homePage")) redirect({ href: "/lib", locale: (await params).locale });
	const { locale } = await params;
	const t = await getTranslations({ locale, namespace: "homePage" });
	const about = config.home
		? contentFrom(config.home, {
				arrival: t("stepArrival"),
				check: t("stepCheck"),
				publication: t("stepPublication"),
				search: t("stepSearch"),
				sync: t("stepSync"),
				duplicates: t("stepDuplicates"),
				fulltext: t("stepFullText"),
			})
		: defaultContent(t("defaultIntro", { name: config.identity.name }));
	// Not awaited: the page renders now and each part built from these figures streams in when they arrive.
	const data = loadHomeData(locale, config);
	const { shapes } = await getWorldMap();
	return (
		<HomePage
			{...tonesFrom(config.theme.colors)}
			rich={homeRich(about, config.identity.baseUrl)}
			shapes={shapes}
			name={config.identity.name}
			siteUrl={config.identity.baseUrl}
			contact={{ email: config.contact.email ?? null, page: getRuntimePageAvailability(config)["/contact"] }}
			today={new Date().toISOString().slice(0, 10)}
			about={about}
			data={data}
		/>
	);
}

type Props = { params: Promise<{ locale: string }> };
