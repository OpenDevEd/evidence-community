import EvidenceLibrary from "@/components/pages/EvidenceLibrary";
import { Metadata } from "next";
import { buildItemsQuery, defaultParams } from "@/lib/utils";
import {
  buildLanguageAlternates,
  buildLocalizedSiteUrl,
} from "@/lib/language-alternates";
import { getItemsPaginationMeta } from "@/lib/search";
import { lastNumberedPage, resultLimitOf } from "@/lib/search-query";
import { cacheLife } from "next/cache";
import { getLibraryConfig } from "@/config/library-config/server";
import SiteStructuredData from "@/components/layout/SiteStructuredData";
import RuntimeMetadata from "@/components/layout/RuntimeMetadata";
import { readSelectedTopicNames } from "@/lib/topics/server";
import { SelectedTopicNames } from "@/components/topics/SelectedTopicNames";
import { LibraryHighlights } from "@/components/features/collections/LibraryHighlights";
import { Suspense } from "react";

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

  // A filtered, searched or sorted list names the plain list as its canonical address, so search engines spend their
  // visits on records rather than on every combination of filters. Only a plain list's own pages keep their number.
  const plain = [...currentUrl.searchParams.keys()].every((key) => key === "page");
  const canonicalPath = plain ? builtUrl : props.pathname;
  const canonical = plain
    ? currentUrl
    : new URL(buildLocalizedSiteUrl(canonicalPath, locale as typeof libraryConfig.localization.defaultLocale, libraryConfig.localization, siteOrigin));

  // Links name numbered pages only: past them, a page needs the cursor its neighbour's results give.
  const numbered = lastNumberedPage(paginationMeta.perPage, resultLimitOf(libraryConfig));
  const pageUrl = (target: number) => {
    const url = new URL(currentUrl);
    url.searchParams.set("page", String(target));
    url.searchParams.delete("after");
    url.searchParams.delete("before");
    return url.toString();
  };
  const previous = page > 1 && page - 1 <= numbered ? pageUrl(page - 1) : null;
  const next = page < totalPages && page + 1 <= numbered ? pageUrl(page + 1) : null;

  return {
    generator: "new-el",
    alternates: {
      canonical,
      languages: buildLanguageAlternates(
        canonicalPath,
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

export default function Lib(props: {
  searchParams: Promise<URLSearchParams>;
}) {
  // Not awaited, so a navigation here stays instant.
  const names = props.searchParams.then((searchParams) =>
    readSelectedTopicNames(defaultParams(searchParams).topics),
  );
  return (
    <>
      <SelectedTopicNames names={names}>
        <EvidenceLibrary
          highlights={
            <Suspense fallback={null}>
              <LibraryHighlights />
            </Suspense>
          }
        />
      </SelectedTopicNames>
      <RuntimeMetadata />
      <Suspense fallback={null}><SiteStructuredData /></Suspense>
    </>
  );
}
