import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { BROWSE_PAGE_SIZE, MONTH_SPLIT, readBrowseMonths, readBrowsePage, readBrowseYears } from "@/lib/browse-records";
import { BrowseMonths, BrowseRecords } from "@/components/browse/BrowsePages";

type Props = { params: Promise<{ year: string }>; searchParams: Promise<{ page?: string }> };

/** The year in the address, or null for the records with no readable year; anything else is not a page. */
function browseYearOf(raw: string) {
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
  const [{ year: raw }, { page: rawPage }, t] = await Promise.all([params, searchParams, getTranslations("browse")]);
  const year = browseYearOf(raw);
  const config = await getLibraryConfig();
  const years = await readBrowseYears(config);
  const order = years.years.map((each) => each.year);
  const at = year === null ? -1 : order.indexOf(year);
  const step = (index: number) => (index >= 0 && index < order.length ? { label: String(order[index]), href: `/browse/${order[index]}` } : null);
  const [older, newer] = at >= 0 ? [step(at + 1), step(at - 1)] : [null, null];
  const total = year === null ? years.undated : years.years[at]?.records ?? 0;
  if (!total) notFound();
  // A busy year is a list of its months, so no page of its records sits many pages deep.
  if (year !== null && total > MONTH_SPLIT) {
    const months = await readBrowseMonths(config, year);
    return <BrowseMonths year={year} total={total} months={months.months} unknown={months.unknown} older={older} newer={newer} />;
  }
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const data = await readBrowsePage(config, year, page);
  if (page > data.pages) notFound();
  return <BrowseRecords title={year === null ? t("noYear") : String(year)} back={{ label: t("title"), href: "/browse" }} older={older} newer={newer} base={`/browse/${raw}`} page={page} perPage={BROWSE_PAGE_SIZE} data={data} />;
}
