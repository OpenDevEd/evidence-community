import EvidenceLibrary from "@/components/pages/EvidenceLibrary";
import { getItems } from "@/lib/actions";
import { Metadata, ResolvingMetadata } from "next";
import { buildItemsQuery, defaultParams } from "@/lib/utils";
import { routing } from "@/i18n/routing";

export async function libraryMetadata(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<URLSearchParams>;
  pathname: string;
}, parent: ResolvingMetadata): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const parentResolved = await parent;
  
  const locale = params.locale;
  
  const queryParams = defaultParams(searchParams);
  const builtUrl = buildItemsQuery(queryParams, props.pathname);
  const items = await getItems(queryParams);
  
  const page = items.currentPage;
  const totalPages = items.totalPages;

  const builtURLObject = new URL(builtUrl, process.env.BASE_URL!);  
  const currentUrl = new URL((locale === routing.defaultLocale ? "" : `/${locale}`) + builtUrl, process.env.BASE_URL!);
  const atomUrl = new URL(builtURLObject.pathname + "/atom.xml?" + builtURLObject.searchParams.toString(), process.env.BASE_URL!);

  const appendedObject = []

  if (page > 1) {
    const prevUrl = new URL(currentUrl);
    prevUrl.searchParams.set("page", String(page - 1));
    const stringifiedPrevUrl = prevUrl.toString();
    appendedObject.push({ rel: "prev", url: stringifiedPrevUrl });
  }
  
  if (page < totalPages) {
    const nextUrl = new URL(currentUrl);
    nextUrl.searchParams.set("page", String(page + 1));
    const stringifiedNextUrl = nextUrl.toString();
    appendedObject.push({ rel: "next", url: stringifiedNextUrl });
  }

  return {
    generator: "new-el",
    alternates: {
      types: {
        "application/atom+xml": atomUrl.toString()
      }
    },
    icons: {
      other: [
        ...(parentResolved.icons?.other ?? []),
        ...appendedObject,
      ]
    }
  }
}

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<URLSearchParams>;
}, parent: ResolvingMetadata): Promise<Metadata> {
  return libraryMetadata({
    ...props,
    pathname: "/lib"
  }, parent);
}

export default async function Lib() {
  return (
    <EvidenceLibrary />
  );
}
