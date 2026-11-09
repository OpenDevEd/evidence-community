import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { BROWSE_PAGE_SIZE, BROWSE_YEAR, browsePageOf, neighboursOf, readBrowseMonths, readBrowsePage } from "@/lib/browse-records";
import { BrowseRecords, BrowseYearPlaceholder } from "@/components/browse/BrowsePages";

type Props = { params: Promise<{ year: string; month: string }>; searchParams: Promise<{ page?: string }> };

/** The month in the address, "unknown" for a year's records that give none; anything else is not a page. */
function monthOf(raw: string) {
  if (raw === "unknown") return "unknown" as const;
  if (!/^(0[1-9]|1[0-2])$/.test(raw)) notFound();
  return Number(raw);
}

async function titleOf(year: number, month: number | "unknown") {
  const [t, format] = await Promise.all([getTranslations("browse"), getFormatter()]);
  return month === "unknown" ? t("noMonthIn", { year }) : format.dateTime(new Date(Date.UTC(year, month - 1, 1)), { month: "long", year: "numeric", timeZone: "UTC" });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const [{ year, month }, config] = await Promise.all([params, getLibraryConfig()]);
  if (!BROWSE_YEAR.test(year)) return {};
  return { title: `${await titleOf(Number(year), monthOf(month))}: ${config.identity.name}`, robots: { index: false, follow: true } };
}

export default function Page(props: Props) {
  return <Suspense fallback={<BrowseYearPlaceholder />}><Records {...props} /></Suspense>;
}

async function Records({ params, searchParams }: Props) {
  await connection();
  const [{ year: rawYear, month: rawMonth }, { page: rawPage }] = await Promise.all([params, searchParams]);
  if (!BROWSE_YEAR.test(rawYear)) notFound();
  const year = Number(rawYear), month = monthOf(rawMonth);
  const page = browsePageOf(rawPage);
  const config = await getLibraryConfig();
  const [data, months, format] = await Promise.all([readBrowsePage(config, year, page, month), readBrowseMonths(config, year), getFormatter()]);
  if (!data.total || page > data.pages) notFound();
  // The neighbours are the months beside this one that hold records, newest first as the year lists them.
  const { older, newer } = neighboursOf(months.months.map((each) => each.month), month, (each) => ({ label: format.dateTime(new Date(Date.UTC(year, each - 1, 1)), { month: "long", timeZone: "UTC" }), href: `/browse/${year}/${String(each).padStart(2, "0")}` }));
  return <BrowseRecords title={await titleOf(year, month)} back={{ label: String(year), href: `/browse/${year}` }} older={older} newer={newer} base={`/browse/${year}/${rawMonth}`} page={page} perPage={BROWSE_PAGE_SIZE} data={data} />;
}
