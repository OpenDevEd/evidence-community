import EvidenceLibrary from "@/components/pages/EvidenceLibrary";
import { Metadata } from "next";
import { buildItemsQuery, defaultParams } from "@/lib/utils";
import {
  buildLanguageAlternates,
  buildLocalizedSiteUrl,
} from "@/lib/language-alternates";
import { getSiteOrigin } from "@/lib/site-url";
import { getItemsPaginationMeta } from "@/lib/search";
import { cacheLife } from "next/cache";

async function getCachedPaginationMeta(queryParams: Parameters<typeof getItemsPaginationMeta>[0]) {
  'use cache'
  cacheLife({ revalidate: 60 })
  return getItemsPaginationMeta(queryParams);
}

export async function libraryMetadata(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<URLSearchParams>;
  pathname: string;
}): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const locale = params.locale;

  const queryParams = defaultParams(searchParams);
  const builtUrl = buildItemsQuery(queryParams, props.pathname);

  const paginationMeta = await getCachedPaginationMeta(queryParams);

  const page = paginationMeta.currentPage;
  const totalPages = paginationMeta.totalPages;

  const siteOrigin = getSiteOrigin();
  const builtURLObject = new URL(builtUrl, siteOrigin);
  const currentUrl = new URL(buildLocalizedSiteUrl(builtUrl, locale));
  const atomUrl = new URL(builtURLObject.pathname + "/atom.xml?" + builtURLObject.searchParams.toString(), siteOrigin);

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
      languages: buildLanguageAlternates(builtUrl),
      types: {
        "application/atom+xml": atomUrl.toString()
      }
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
    pathname: "/lib"
  });
}

export default async function Lib() {
  return (
    <EvidenceLibrary />
  );
}
