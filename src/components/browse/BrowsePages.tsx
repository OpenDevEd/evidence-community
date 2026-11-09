import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft01Icon, ArrowRight01Icon, BookOpen01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { Link } from "@/i18n/routing";
import PageContainer from "@/components/layout/PageContainer";
import { Icon, TextLink, muted } from "@/components/digests/DigestPrimitives";
import { creatorDisplayName } from "@/lib/creator-display-name";
import { twMerge } from "@/lib/tw-merge";
import type { readBrowsePage, readBrowseYears } from "@/lib/browse-records";

type Years = Awaited<ReturnType<typeof readBrowseYears>>;
type Page = Awaited<ReturnType<typeof readBrowsePage>>;

/** Every year that holds records, by decade: a crawler, or a reader, reaches any record from here in two more links. */
export async function BrowseYears({ name, data }: { name: string; data: Years }) {
  const t = await getTranslations("browse");
  const format = await getFormatter();
  const largest = Math.max(1, ...data.years.map((year) => year.records));
  const total = data.years.reduce((sum, year) => sum + year.records, data.undated);
  const decades = [...new Set(data.years.map((year) => Math.floor(year.year / 10) * 10))];
  return <PageContainer className="mx-auto max-w-5xl">
    <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-xl">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("title")}</h1>
        <p className={`mt-3 text-base leading-7 ${muted}`}>{t("intro", { name })}</p>
      </div>
      <p className="flex items-baseline gap-2 sm:flex-col sm:items-end sm:gap-0"><span className="text-3xl font-semibold tabular-nums">{format.number(total)}</span><span className={`text-sm ${muted}`}>{t("recordsWord", { count: total })}</span></p>
    </header>
    <div className="space-y-10">
      {decades.map((decade) => {
        const years = data.years.filter((year) => Math.floor(year.year / 10) * 10 === decade);
        return <section key={decade} aria-labelledby={`decade-${decade}`}>
          <h2 id={`decade-${decade}`} className="mb-3 flex items-baseline justify-between text-sm font-medium"><span>{t("decade", { decade })}</span><span className={`tabular-nums ${muted}`}>{t("records", { count: years.reduce((sum, year) => sum + year.records, 0) })}</span></h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {years.map((year) => <li key={year.year}>
              <Link href={`/browse/${year.year}`} className="group block rounded-2xl bg-card_light p-4 outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-accent dark:bg-card dark:hover:bg-white/5">
                <span className="block text-2xl font-semibold tabular-nums transition-colors group-hover:text-accent">{year.year}</span>
                <span className={`mt-1 block text-sm tabular-nums ${muted}`}>{t("records", { count: year.records })}</span>
                <span aria-hidden="true" className="mt-3 block h-1.5 rounded-full bg-accent/15"><span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (year.records / largest) * 100)}%` }} /></span>
              </Link>
            </li>)}
          </ul>
        </section>;
      })}
      {data.undated > 0 && <section aria-labelledby="undated">
        <h2 id="undated" className="mb-3 text-sm font-medium">{t("noYear")}</h2>
        <Link href="/browse/undated" className="group inline-flex items-baseline gap-3 rounded-2xl bg-card_light px-4 py-3 outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-accent dark:bg-card dark:hover:bg-white/5"><span className="font-semibold group-hover:text-accent">{t("noYearLink")}</span><span className={`text-sm tabular-nums ${muted}`}>{t("records", { count: data.undated })}</span></Link>
      </section>}
    </div>
  </PageContainer>;
}

/** One year's records as plain links, a page at a time, with every page linked so none is more than one step away. */
export async function BrowseYear({ year, page, data, years }: { year: number | null; page: number; data: Page; years: Years }) {
  const t = await getTranslations("browse");
  const format = await getFormatter();
  const order = years.years.map((each) => each.year);
  const at = year === null ? -1 : order.indexOf(year);
  const newer = at > 0 ? order[at - 1] : null;
  const older = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  const base = `/browse/${year ?? "undated"}`;
  const step = "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5";
  return <PageContainer className="mx-auto max-w-4xl">
    <TextLink href="/browse" back>{t("title")}</TextLink>
    <header className="mb-8 mt-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-5xl font-bold tabular-nums tracking-tight">{year ?? t("noYear")}</h1>
        <p className={`mt-2 text-base tabular-nums ${muted}`}>{t("records", { count: data.total })}</p>
      </div>
      {year !== null && <nav aria-label={t("otherYears")} className="flex gap-1">
        {older ? <Link href={`/browse/${older}`} className={step}><Icon value={ArrowLeft01Icon} size={16} /><span className="tabular-nums">{older}</span></Link> : null}
        {newer ? <Link href={`/browse/${newer}`} className={step}><span className="tabular-nums">{newer}</span><Icon value={ArrowRight01Icon} size={16} /></Link> : null}
      </nav>}
    </header>
    <ol className="rounded-2xl bg-card_light p-2 dark:bg-card">
      {data.records.map((record) => {
        const authors = (record.creators ?? []).filter((creator) => creator.creatorType === "author").map(creatorDisplayName).filter(Boolean);
        return <li key={record.key}>
          <Link href={`/lib/${record.key}`} className="group block rounded-xl px-4 py-3 outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-white/5">
            <span className="block font-medium leading-snug transition-colors group-hover:text-accent">{record.title || t("untitled")}</span>
            <span className={`mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm ${muted}`}>
              {authors.length > 0 && <span className="inline-flex min-w-0 items-center gap-1.5"><Icon value={UserIcon} size={14} /><span className="truncate">{authors.length > 3 ? t("authorsMore", { first: authors.slice(0, 3).join(", "), more: authors.length - 3 }) : authors.join(", ")}</span></span>}
              {record.publicationTitle && <span className="inline-flex min-w-0 items-center gap-1.5"><Icon value={BookOpen01Icon} size={14} /><span className="truncate italic">{record.publicationTitle}</span></span>}
            </span>
          </Link>
        </li>;
      })}
    </ol>
    {data.pages > 1 && <nav aria-label={t("pages")} className="mt-8">
      <h2 className={`mb-3 text-sm ${muted}`}>{t("pageOf", { page: format.number(page), pages: format.number(data.pages) })}</h2>
      <ul className="flex flex-wrap gap-1.5">
        {Array.from({ length: data.pages }, (_, index) => index + 1).map((number) => <li key={number}>
          <Link href={number === 1 ? base : `${base}?page=${number}`} aria-current={number === page ? "page" : undefined} className={twMerge("grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent", number === page ? "bg-accent text-white" : "bg-card_light hover:bg-black/5 dark:bg-card dark:hover:bg-white/5")}>{number}</Link>
        </li>)}
      </ul>
    </nav>}
  </PageContainer>;
}
