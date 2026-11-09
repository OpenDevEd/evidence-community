import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { BROWSE_PAGE_SIZE, readBrowseMonths, readBrowsePage } from "@/lib/browse-records";
import { BrowseRecords } from "@/components/browse/BrowsePages";

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
  if (!/^(1[5-9]|20)\d{2}$/.test(year)) return {};
  return { title: `${await titleOf(Number(year), monthOf(month))}: ${config.identity.name}`, robots: { index: false, follow: true } };
}

export default async function Page({ params, searchParams }: Props) {
  await connection();
  const [{ year: rawYear, month: rawMonth }, { page: rawPage }] = await Promise.all([params, searchParams]);
  if (!/^(1[5-9]|20)\d{2}$/.test(rawYear)) notFound();
  const year = Number(rawYear), month = monthOf(rawMonth);
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const config = await getLibraryConfig();
  const [data, months, format] = await Promise.all([readBrowsePage(config, year, page, month), readBrowseMonths(config, year), getFormatter()]);
  if (!data.total || page > data.pages) notFound();
  // The neighbours are the months beside this one that hold records, newest first as the year lists them.
  const order = months.months.map((each) => each.month);
  const at = month === "unknown" ? -1 : order.indexOf(month);
  const step = (index: number) => (index >= 0 && index < order.length ? { label: format.dateTime(new Date(Date.UTC(year, order[index]! - 1, 1)), { month: "long", timeZone: "UTC" }), href: `/browse/${year}/${String(order[index]).padStart(2, "0")}` } : null);
  return <BrowseRecords title={await titleOf(year, month)} back={{ label: String(year), href: `/browse/${year}` }} older={at >= 0 ? step(at + 1) : null} newer={at >= 0 ? step(at - 1) : null} base={`/browse/${year}/${rawMonth}`} page={page} perPage={BROWSE_PAGE_SIZE} data={data} />;
}
