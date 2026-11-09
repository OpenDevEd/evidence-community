import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { readBrowseYears } from "@/lib/browse-records";
import { BrowseYears } from "@/components/browse/BrowsePages";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const [config, t] = await Promise.all([getLibraryConfig(), getTranslations("browse")]);
  // Followed, not listed: the page is a path to every record for crawlers, and the records are what should come up in search.
  return { title: `${t("title")}: ${config.identity.name}`, robots: { index: false, follow: true } };
}

export default async function Page() {
  await connection();
  const config = await getLibraryConfig();
  return <BrowseYears name={config.identity.name} data={await readBrowseYears(config)} />;
}
