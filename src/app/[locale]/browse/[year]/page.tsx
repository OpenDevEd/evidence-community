import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { BROWSE_PAGE_SIZE, BROWSE_YEAR, MONTH_SPLIT, browsePageOf, readBrowseMonths, readBrowsePage, readBrowseYear } from "@/lib/browse-records";
import { BrowseMonths, BrowseRecords, BrowseYearPlaceholder } from "@/components/browse/BrowsePages";

type Props = { params: Promise<{ year: string }>; searchParams: Promise<{ page?: string }> };

/** The year in the address, or null for the records with no readable year; anything else is not a page. */
function browseYearOf(raw: string) {
  if (raw === "undated") return null;
  if (!BROWSE_YEAR.test(raw)) notFound();
  return Number(raw);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const [{ year }, config, t] = await Promise.all([params, getLibraryConfig(), getTranslations("browse")]);
  return { title: `${year === "undated" ? t("noYear") : year}: ${config.identity.name}`, robots: { index: false, follow: true } };
}

export default function Page(props: Props) {
  return <Suspense fallback={<BrowseYearPlaceholder />}><Records {...props} /></Suspense>;
}

async function Records({ params, searchParams }: Props) {
  await connection();
  const [{ year: raw }, { page }, config] = await Promise.all([params, searchParams, getLibraryConfig()]);
  const year = browseYearOf(raw);
  const { total, older, newer } = await readBrowseYear(config, year);
  if (!total) notFound();
  // A busy year is a list of its months, so no page of its records sits many pages deep.
  if (year !== null && total > MONTH_SPLIT) return <YearMonths config={config} year={year} total={total} older={older} newer={newer} />;
  return <YearRecords config={config} year={year} raw={raw} page={browsePageOf(page)} older={older} newer={newer} />;
}

type Step = { label: string; href: string } | null;

async function YearMonths({ config, year, total, older, newer }: { config: LibraryServerConfig; year: number; total: number; older: Step; newer: Step }) {
  const { months, unknown } = await readBrowseMonths(config, year);
  return <BrowseMonths year={year} total={total} months={months} unknown={unknown} older={older} newer={newer} />;
}

async function YearRecords({ config, year, raw, page, older, newer }: { config: LibraryServerConfig; year: number | null; raw: string; page: number; older: Step; newer: Step }) {
  const [data, t] = await Promise.all([readBrowsePage(config, year, page), getTranslations("browse")]);
  if (page > data.pages) notFound();
  return <BrowseRecords title={year === null ? t("noYear") : raw} back={{ label: t("title"), href: "/browse" }} older={older} newer={newer} base={`/browse/${raw}`} page={page} perPage={BROWSE_PAGE_SIZE} data={data} />;
}
