import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { buildLanguageAlternates, buildLocalizedSiteUrl } from "@/lib/language-alternates";
import { getLatestDigest, getNextDigestEdition, listDigestChart, listDigestEditions, pageNumber } from "@/lib/notifications/public";
import DigestPages from "@/components/digests/DigestPages";
import { readDigests } from "./read";

type Props = {params: Promise<{locale: string}>; searchParams: Promise<{page?: string}>};

/** The archive's own title and address, in each language, so search engines tell it from the community's other pages. */
export async function generateMetadata({params}: Props): Promise<Metadata> {
  await connection();
  const [{locale}, {identity, localization}, t] = await Promise.all([params, getLibraryConfig(), getTranslations("digests")]);
  return {
    title: `${t("digests")}: ${identity.name}`,
    alternates: {
      canonical: buildLocalizedSiteUrl("/digests", locale as typeof localization.defaultLocale, localization, identity.baseUrl),
      languages: buildLanguageAlternates("/digests", localization, identity.baseUrl),
    },
  };
}

export default function Page({params, searchParams}: Props) {
  const locale = params.then(value => value.locale);
  const page = searchParams.then(value => pageNumber(value.page));
  return <DigestPages view="archive"
    latest={readDigests(locale, getLatestDigest)}
    editions={readDigests(locale, async (db, config, locale) => listDigestEditions(db, config, locale, await page))}
    chart={readDigests(locale, listDigestChart)}
    nextEdition={readDigests(locale, (db, config, locale) => getNextDigestEdition(db, config, locale))} />;
}
