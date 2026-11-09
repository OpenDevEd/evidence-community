"use client";

import { useFormatter, useTranslations } from "next-intl";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Link } from "@/i18n/routing";
import PageContainer from "@/components/layout/PageContainer";
import { Button } from "@/components/nextui/Button";
import Resource from "@/components/features/items/Resource";
import { FacetOption } from "@/components/features/collections/FacetOption";
import { HeadFigure, SidebarCard } from "@/components/features/collections/SidebarCard";
import { Skeleton } from "@/components/nextui/Skeleton";
import { TextLink, muted } from "@/components/digests/DigestPrimitives";
import { AuthorProfilesContext } from "@/lib/authors/use-author-profiles";
import type { readBrowsePage, readBrowseYears } from "@/lib/browse-records";
import { BrowsePager } from "./BrowsePager";

const recordGrid = "grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3";

type Years = Awaited<ReturnType<typeof readBrowseYears>>;
type Page = Awaited<ReturnType<typeof readBrowsePage>>;

/** A year as a sidebar option: its count, and a bar against the busiest year, linking to the year's records. */
const optionRow = "block rounded-xl px-3 py-2 outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-white/5";

/** Every year that holds records, a card per decade as the sidebar shows its filters: any record is two more links away. */
export function BrowseYears({ name, data }: { name: string; data: Years }) {
  const t = useTranslations("browse");
  const format = useFormatter();
  const largest = Math.max(1, ...data.years.map((year) => year.records));
  const total = data.years.reduce((sum, year) => sum + year.records, data.undated);
  const decades = [...new Set(data.years.map((year) => Math.floor(year.year / 10) * 10))];
  return <PageContainer className="mx-auto">
    <header className="mb-8 flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-xl">
        <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">{t("title")}</h1>
        <p className={`mt-3 text-base leading-7 ${muted}`}>{t("intro", { name })}</p>
      </div>
      <HeadFigure value={format.number(total)} label={t("recordsWord", { count: total })} />
    </header>
    <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {decades.map((decade) => {
        const years = data.years.filter((year) => Math.floor(year.year / 10) * 10 === decade);
        const records = years.reduce((sum, year) => sum + year.records, 0);
        return <SidebarCard key={decade} title={t("decade", { decade })} aside={<span className={`text-sm tabular-nums ${muted}`}>{format.number(records)}</span>}>
          <ul className="-mx-3 flex flex-col">
            {years.map((year) => <li key={year.year}><Link href={`/browse/${year.year}`} className={optionRow}>
              <FacetOption label={String(year.year)} count={year.records} largest={largest} share={null} shareValue={null} arrow={null} arrowSlot={false} />
            </Link></li>)}
          </ul>
        </SidebarCard>;
      })}
      {data.undated > 0 && <SidebarCard title={t("noYear")}>
        <div className="-mx-3"><Link href="/browse/undated" className={optionRow}>
          <FacetOption label={t("noYearLink")} count={data.undated} largest={largest} share={null} shareValue={null} arrow={null} arrowSlot={false} />
        </Link></div>
      </SidebarCard>}
    </div>
  </PageContainer>;
}

type Step = { label: string; href: string };

/** Where the reader can step to beside a page of records: the period before and after it that hold records. */
function Neighbours({ older, newer, label }: { older: Step | null; newer: Step | null; label: string }) {
  if (!older && !newer) return null;
  return <nav aria-label={label} className="flex gap-2">
    {older ? <Button as={Link} role="link" href={older.href} startContent={<HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden className="size-4 rtl:rotate-180" />}><span className="tabular-nums">{older.label}</span></Button> : null}
    {newer ? <Button as={Link} role="link" href={newer.href} endContent={<HugeiconsIcon icon={ArrowRight01Icon} aria-hidden className="size-4 rtl:rotate-180" />}><span className="tabular-nums">{newer.label}</span></Button> : null}
  </nav>;
}

/** A period's records as the library's result cards, a page at a time under the library's pager: a small year, or one month of a busy one. */
export function BrowseRecords({ title, back, older, newer, base, page, perPage, data }: { title: string; back: Step; older: Step | null; newer: Step | null; base: string; page: number; perPage: number; data: Page }) {
  const t = useTranslations("browse");
  return <PageContainer className="mx-auto">
    <TextLink href={back.href} back>{back.label}</TextLink>
    <header className="mb-6 mt-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-heading text-5xl font-semibold tabular-nums tracking-tight">{title}</h1>
        <p className={`mt-2 text-base tabular-nums ${muted}`}>{t("records", { count: data.total })}</p>
      </div>
      <Neighbours older={older} newer={newer} label={t("otherPeriods")} />
    </header>
    {/* The server read the authors with the cards, so no card looks them up on its own. */}
    <AuthorProfilesContext value={new Map(data.profiles.map((profile) => [profile.id, profile]))}>
      {/* The listing's grid view: two columns from lg, a third on very wide screens. */}
      <div className={recordGrid}>{data.cards.map((card) => <Resource key={card.key} as="div" abstract hideUnapi itemData={card} />)}</div>
    </AuthorProfilesContext>
    <div className="mt-8"><BrowsePager base={base} page={page} pages={data.pages} total={data.total} perPage={perPage} /></div>
  </PageContainer>;
}

/** A busy year as its months, each a sidebar option with its count and bar, so none of its records is many pages deep. */
export function BrowseMonths({ year, total, months, unknown, older, newer }: { year: number; total: number; months: { month: number; records: number }[]; unknown: number; older: Step | null; newer: Step | null }) {
  const t = useTranslations("browse");
  const format = useFormatter();
  const largest = Math.max(1, ...months.map((month) => month.records), unknown);
  const name = (month: number) => format.dateTime(new Date(Date.UTC(year, month - 1, 1)), { month: "long", timeZone: "UTC" });
  return <PageContainer className="mx-auto">
    <TextLink href="/browse" back>{t("title")}</TextLink>
    <header className="mb-6 mt-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-heading text-5xl font-semibold tabular-nums tracking-tight">{year}</h1>
        <p className={`mt-2 text-base tabular-nums ${muted}`}>{t("records", { count: total })}</p>
      </div>
      <Neighbours older={older} newer={newer} label={t("otherPeriods")} />
    </header>
    <div className="max-w-xl">
      <SidebarCard title={t("months")} aside={<span className={`text-sm tabular-nums ${muted}`}>{format.number(total)}</span>}>
        <ul className="-mx-3 flex flex-col">
          {months.map((month) => <li key={month.month}><Link href={`/browse/${year}/${String(month.month).padStart(2, "0")}`} className={optionRow}>
            <FacetOption label={name(month.month)} count={month.records} largest={largest} share={null} shareValue={null} arrow={null} arrowSlot={false} />
          </Link></li>)}
          {unknown > 0 && <li><Link href={`/browse/${year}/unknown`} className={optionRow}>
            <FacetOption label={t("noMonth")} count={unknown} largest={largest} share={null} shareValue={null} arrow={null} arrowSlot={false} />
          </Link></li>}
        </ul>
      </SidebarCard>
    </div>
  </PageContainer>;
}

/** The year index while it's on its way: the heading as it will be, and decade cards whose rows are still loading. */
export function BrowseYearsPlaceholder() {
  const t = useTranslations("browse");
  return <PageContainer className="mx-auto">
    <header className="mb-8"><h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">{t("title")}</h1><Skeleton isLoaded={false} className="mt-4 h-5 w-96 max-w-full rounded-lg" /></header>
    <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((card) => <SidebarCard key={card} title={<Skeleton isLoaded={false} className="h-6 w-20 rounded-lg" />}>
        <div className="flex flex-col gap-4">{[0, 1, 2, 3, 4].map((row) => <Skeleton key={row} isLoaded={false} className="h-6 w-full rounded-lg" />)}</div>
      </SidebarCard>)}
    </div>
  </PageContainer>;
}

/** A year's page while it's on its way: its year, already known from the address, over result cards still loading. */
export function BrowseYearPlaceholder({ year, month }: { year: string; month?: string }) {
  const t = useTranslations("browse");
  const format = useFormatter();
  const title = year === "undated" ? t("noYear") : !month ? year : month === "unknown" ? t("noMonthIn", { year }) : format.dateTime(new Date(Date.UTC(Number(year), Number(month) - 1, 1)), { month: "long", year: "numeric", timeZone: "UTC" });
  return <PageContainer className="mx-auto">
    <TextLink href={month ? `/browse/${year}` : "/browse"} back>{month ? year : t("title")}</TextLink>
    <header className="mb-6 mt-6"><h1 className="font-heading text-5xl font-semibold tabular-nums tracking-tight">{title}</h1><Skeleton isLoaded={false} className="mt-3 h-5 w-28 rounded-lg" /></header>
    <div className={recordGrid}>{[0, 1, 2, 3, 4, 5].map((card) => <Resource key={card} as="div" abstract hideUnapi isLoading />)}</div>
  </PageContainer>;
}
