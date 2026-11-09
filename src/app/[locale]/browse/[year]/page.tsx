import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { readBrowsePage, readBrowseYears } from "@/lib/browse-records";
import { BrowseYear } from "@/components/browse/BrowsePages";

type Props = { params: Promise<{ year: string }>; searchParams: Promise<{ page?: string }> };

/** The year in the address, or null for the records with no readable year; anything else is not a page. */
function yearOf(raw: string) {
  if (raw === "undated") return null;
  if (!/^(1[5-9]|20)\d{2}$/.test(raw)) notFound();
  return Number(raw);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const [{ year }, config, t] = await Promise.all([params, getLibraryConfig(), getTranslations("browse")]);
  return { title: `${year === "undated" ? t("noYear") : year}: ${config.identity.name}`, robots: { index: false, follow: true } };
}

export default async function Page({ params, searchParams }: Props) {
  await connection();
  const [{ year: raw }, { page: rawPage }] = await Promise.all([params, searchParams]);
  const year = yearOf(raw);
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const config = await getLibraryConfig();
  const [data, years] = await Promise.all([readBrowsePage(config, year, page), readBrowseYears(config)]);
  if (page > data.pages || (!data.total && year !== null)) notFound();
  return <BrowseYear year={year} page={page} data={data} years={years} />;
}
