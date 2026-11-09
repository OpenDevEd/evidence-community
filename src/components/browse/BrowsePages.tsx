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

/** One year's records as the library's result cards, a page at a time under the library's pager. */
export function BrowseYear({ year, page, perPage, data, years }: { year: number | null; page: number; perPage: number; data: Page; years: Years }) {
  const t = useTranslations("browse");
  const order = years.years.map((each) => each.year);
  const at = year === null ? -1 : order.indexOf(year);
  const newer = at > 0 ? order[at - 1] : null;
  const older = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  return <PageContainer className="mx-auto max-w-5xl">
    <TextLink href="/browse" back>{t("title")}</TextLink>
    <header className="mb-6 mt-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-heading text-5xl font-semibold tabular-nums tracking-tight">{year ?? t("noYear")}</h1>
        <p className={`mt-2 text-base tabular-nums ${muted}`}>{t("records", { count: data.total })}</p>
      </div>
      {year !== null && <nav aria-label={t("otherYears")} className="flex gap-2">
        {older ? <Button as={Link} role="link" href={`/browse/${older}`} startContent={<HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden className="size-4 rtl:rotate-180" />}><span className="tabular-nums">{older}</span></Button> : null}
        {newer ? <Button as={Link} role="link" href={`/browse/${newer}`} endContent={<HugeiconsIcon icon={ArrowRight01Icon} aria-hidden className="size-4 rtl:rotate-180" />}><span className="tabular-nums">{newer}</span></Button> : null}
      </nav>}
    </header>
    {/* The server read the authors with the cards, so no card looks them up on its own. */}
    <AuthorProfilesContext value={new Map(data.profiles.map((profile) => [profile.id, profile]))}>
      <div className="flex flex-col gap-4">{data.cards.map((card) => <Resource key={card.key} as="div" abstract hideUnapi itemData={card} />)}</div>
    </AuthorProfilesContext>
    <div className="mt-8"><BrowsePager base={`/browse/${year ?? "undated"}`} page={page} pages={data.pages} total={data.total} perPage={perPage} /></div>
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
export function BrowseYearPlaceholder({ year }: { year: string }) {
  const t = useTranslations("browse");
  return <PageContainer className="mx-auto max-w-5xl">
    <TextLink href="/browse" back>{t("title")}</TextLink>
    <header className="mb-6 mt-6"><h1 className="font-heading text-5xl font-semibold tabular-nums tracking-tight">{year === "undated" ? t("noYear") : year}</h1><Skeleton isLoaded={false} className="mt-3 h-5 w-28 rounded-lg" /></header>
    <div className="flex flex-col gap-4">{[0, 1, 2].map((card) => <Resource key={card} as="div" abstract hideUnapi isLoading />)}</div>
  </PageContainer>;
}
