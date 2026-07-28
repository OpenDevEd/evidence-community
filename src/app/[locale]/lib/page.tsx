import EvidenceLibrary from "@/components/pages/EvidenceLibrary";
import { Metadata } from "next";
import { buildItemsQuery, defaultParams } from "@/lib/utils";
import {
  buildLanguageAlternates,
  buildLocalizedSiteUrl,
} from "@/lib/language-alternates";
import { getItemsPaginationMeta } from "@/lib/search";
import { cacheLife } from "next/cache";
import { getLibraryConfig } from "@/config/library-config/server";

async function getCachedPaginationMeta(
  queryParams: Parameters<typeof getItemsPaginationMeta>[0],
  configRevision: string,
) {
  'use cache'
  cacheLife({ revalidate: 60 })
  return getItemsPaginationMeta(queryParams);
}

export async function libraryMetadata(props: {
  atomFeedPath?: string;
  params: Promise<{ locale: string }>;
  searchParams: Promise<URLSearchParams>;
  pathname: string;
}): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const locale = params.locale;

  const queryParams = defaultParams(searchParams);
  const builtUrl = buildItemsQuery(queryParams, props.pathname);

  const libraryConfig = await getLibraryConfig();
  const paginationMeta = await getCachedPaginationMeta(
    queryParams,
    libraryConfig.revision,
  );

  const page = paginationMeta.currentPage;
  const totalPages = paginationMeta.totalPages;

  const siteOrigin = libraryConfig.identity.baseUrl;
  const currentUrl = new URL(
    buildLocalizedSiteUrl(
      builtUrl,
      locale as typeof libraryConfig.localization.defaultLocale,
      libraryConfig.localization,
      siteOrigin,
    ),
  );
  const atomUrl = props.atomFeedPath
    ? new URL(props.atomFeedPath, siteOrigin)
    : null;
  const atomFeedEnabled =
    atomUrl &&
    libraryConfig.features.atomFeed &&
    Boolean(libraryConfig.exports.atom);

  let previous: string | null = null;
  let next: string | null = null;

  if (page > 1) {
    const prevUrl = new URL(currentUrl);
    prevUrl.searchParams.set("page", String(page - 1));
    previous = prevUrl.toString();
  }

  if (page < totalPages) {
    const nextUrl = new URL(currentUrl);
    nextUrl.searchParams.set("page", String(page + 1));
    next = nextUrl.toString();
  }

  return {
    generator: "new-el",
    alternates: {
      canonical: currentUrl,
      languages: buildLanguageAlternates(
        builtUrl,
        libraryConfig.localization,
        siteOrigin,
      ),
      types: atomFeedEnabled
        ? {
            "application/atom+xml": atomUrl.toString()
          }
        : undefined
    },
    pagination: { previous, next }
  }
}

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<URLSearchParams>;
}): Promise<Metadata> {
  return libraryMetadata({
    ...props,
    atomFeedPath: "/lib/atom.xml",
    pathname: "/lib"
  });
}

export default async function Lib() {
  return (
    <EvidenceLibrary />
  );
}
