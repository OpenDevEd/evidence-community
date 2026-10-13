"use client";

import { Fragment, Suspense, use, useEffect, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { notFound } from "next/navigation";
import { Link, useRouter } from "@/i18n/routing";
import PageContainer from "@/components/layout/PageContainer";
import { Accordion, AccordionItem } from "@nextui-org/react";
import { useReducedMotion } from "framer-motion";
import { ACCORDION_CONTENT_MOTION } from "@/components/nextui/accordion-motion";
import { AiMagicIcon, Calendar03Icon, BookOpen01Icon, Notification03Icon } from "@hugeicons/core-free-icons";
import type { DigestArchivePage, DigestChart, DigestDate, DigestEdition, DigestSignature, DigestSummary, EditionTypes } from "@/lib/notifications/public";
import type { ListItem } from "@/app/api/item/types";
import { AuthorProfilesContext } from "@/lib/authors/use-author-profiles";
import type { AuthorProfile } from "@/lib/authors/profiles";
import { Pagination } from "@/components/nextui/Pagination";
import { describeDigestSchedule, timeZoneLabel, type DigestPeriod } from "@/lib/notifications/schedule";
import { DIGEST_SIGNER_ROLE, type DigestTypeCounts } from "@/lib/notifications/types";
import { STUDY_LEVELS, STUDY_TYPES, type StudyLevel } from "@/lib/readings/study-types";
import { studyTone } from "@/components/features/items/study-tone";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { Skeleton } from "@/components/nextui/Skeleton";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { HINT_UNDERLINE, Hint, Tooltip } from "@/components/nextui/Tooltip";
import { twMerge } from "@/lib/tw-merge";
import styles from "./DigestPages.module.css";
import Resource from "@/components/features/items/Resource";
import { HeadFigure, SidebarCard, barWidth } from "@/components/features/collections/SidebarCard";

import { AIMarkdown, MarkdownExcerpt } from "@/components/features/markdown/Markdown";
import { CitedPublications, type CitedPublicationsByKey } from "@/components/features/markdown/Citation";


import { SectionTitle } from "@/components/typography/SectionTitle";
import { Face, Icon, TextLink, muted } from "./DigestPrimitives";
import { DigestCover, FirstEditionCover, coverHeight, publicationCount } from "./DigestCover";
import { Subscription, type Preferences } from "./Subscription";
import { editionParts, type Part } from "./edition-parts";

/**
 * A list with its page controls. The page number lives in the URL, so every page can be shared and reloaded. Turning
 * the page brings `anchor`, the list's heading, into view at once, and the rows on show stay, dimmed, until the next
 * page's rows are in.
 */
function Paged({page, pages, href, anchor, children}: {page: number; pages: number; href: (page: number) => string; anchor: string; children: ReactNode}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(page);
  function turn(next: number) {
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(anchor)?.scrollIntoView({behavior: instant ? "auto" : "smooth", block: "start"});
    startTransition(() => {
      setShown(next);
      router.push(`${href(next)}#${anchor}`, {scroll: false});
    });
  }
  return <>
    <div aria-busy={pending} className={twMerge("transition-opacity duration-200 motion-reduce:transition-none", pending && "pointer-events-none opacity-50")}>{children}</div>
    {pages > 1 && <Pagination showControls page={shown} total={pages} onChange={turn} className="mt-6 flex justify-center" />}
  </>;
}

/** Who stands behind an edition: the person who checked it, or that AI wrote it and nobody has. Nothing when the library does not say. */
function Attribution({ by }: { by: DigestSignature | undefined }) {
  if (by === undefined) return null;
  return by
    ? <span className="inline-flex items-center gap-1.5"><Face person={by} size={18} />Checked by {by.name}</span>
    : <span className="inline-flex items-center gap-1.5"><Icon value={AiMagicIcon} size={14} />Written by AI</span>;
}
function EditionMeta({ edition }: { edition: DigestEdition }) {
  const locale = useLocale();
  const timezone = useLibraryConfig().notifications.schedule.timezone;
  return <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-sm ${muted}`}>
    <Hint content={<PeriodCard period={edition.period} timezone={timezone} />} {...headerHint}><Icon value={Calendar03Icon} size={16} /><time dateTime={edition.period.first}>{edition.period.label}</time></Hint>
    <Hint content={<CountCard edition={edition} locale={locale} />} {...headerHint}><Icon value={BookOpen01Icon} size={16} />{publicationCount(edition.publicationCount, locale)}</Hint>
    <Attribution by={edition.by} />
  </div>;
}
/** The header's hints open below their text, as wide as their cards need. */
const headerHint = {placement: "bottom-start", contentClassName: "w-96 max-w-[calc(100vw-24px)] p-4"} as const;
const cardText = "text-sm leading-6 text-black/70 dark:text-white/70";
/** The first and last day an edition covers, joined by a line, and which date of a publication puts it in. */
function PeriodCard({ period, timezone }: { period: DigestPeriod; timezone: string }) {
  // OpenAlex gives a work it knows only the year of 1 January, so a period that includes that day says so.
  const newYear = `${period.year}-01-01`;
  const yearOnly = period.first <= newYear && newYear <= period.last;
  const end = (label: string, date: string) => <span className="min-w-0"><span className={`block text-xs ${muted}`}>{label}</span><span className="block whitespace-nowrap font-medium tabular-nums">{date}</span></span>;
  return <div className="flex flex-col gap-3">
    <div className="grid grid-cols-[auto_minmax(1.5rem,1fr)_auto] items-end gap-3">
      {end("First day", period.from)}<span aria-hidden className="mb-2.5 h-0.5 rounded-full bg-accent/40" />{end("Last day", period.to)}
    </div>
    <p className={cardText}>Publications enter by their publication date, the one OpenAlex gives, which is usually the day they first came out online. Days are in {timeZoneLabel(timezone)}.</p>
    {yearOnly && <p className={cardText}>OpenAlex dates a work it knows only the year of 1 January, so those works are in this period too.</p>}
  </div>;
}
/**
 * What the edition's count holds, and how much of it the AI read, the edition lists and the text cites, as bars of one
 * scale, with why each is smaller than the one before. The header's count, the Publications card and the list's
 * heading all open it.
 */
function CountCard({ edition, locale }: { edition: DigestEdition; locale: string }) {
  const n = (count: number) => count.toLocaleString(locale);
  const rows = [
    {count: edition.publicationCount, label: "dated in this period"},
    {count: edition.read, label: "read by the AI that wrote the text"},
    {count: edition.listed, label: "listed in this edition"},
    {count: edition.cited, label: "cited in the text"},
  ];
  const hidden = edition.read - edition.listed;
  return <div className="flex flex-col gap-3">
    <ul className="flex flex-col gap-2.5">{rows.map(row => <li key={row.label}>
      <p className="flex items-baseline gap-2"><span className="font-heading text-base font-semibold tabular-nums">{row.count.toLocaleString(locale)}</span><span className={`text-sm ${muted}`}>{row.label}</span></p>
      <span aria-hidden className="mt-1 block h-1.5 rounded-full bg-black/10 dark:bg-white/15"><span className={twMerge("block h-full rounded-full bg-accent", row.count > 0 && "min-w-[3px]")} style={{width: `${(row.count / edition.publicationCount) * 100}%`}} /></span>
    </li>)}</ul>
    <p className={cardText}>The count holds every publication in this library dated in the period, as the library stood on {edition.counted}. Works OpenAlex added after that day are not in it. Records with the same title and first author count once. Retracted papers and journal front matter are left out.</p>
    {(edition.read < edition.publicationCount || hidden > 0) && <p className={cardText}>
      {edition.read < edition.publicationCount && `The AI reads at most 1,000 publications or 1.5 MB of text, so it read the ${n(edition.read)} that rank highest. `}
      {hidden > 0 && `The library has taken ${n(hidden)} of them down since, so ${n(edition.listed)} are listed.`}
    </p>}
  </div>;
}
/** A count of the edition's publications that opens the count's card on hover, wherever the page shows it. */
function CountHint({ edition, locale, children }: { edition: DigestEdition; locale: string; children: ReactNode }) {
  return <Hint content={<CountCard edition={edition} locale={locale} />} placement="bottom-end" contentClassName={headerHint.contentClassName}>{children}</Hint>;
}
/** The words of the person who checked the edition, above its text. */
function EditorNote({ edition }: { edition: DigestEdition }) {
  if (!edition.note || !edition.by) return null;
  return <figure className="mb-10 rounded-2xl bg-card_light p-6 dark:bg-card">
    <blockquote className="whitespace-pre-line text-base leading-7">{edition.note}</blockquote>
    <figcaption className="mt-4 flex items-center gap-3 text-sm">
      <Face person={edition.by} size={36} />
      <span className="font-medium">{edition.by.name}</span>{edition.by.role && <span className={muted}>{DIGEST_SIGNER_ROLE[edition.by.role]}</span>}
    </figcaption>
  </figure>;
}


const newReader: Preferences = {email: "", digest: true, instant: false, confirmed: false};
type DigestSettings = {libraryName: string; enabled: boolean; /** What a digest is about: publications dated in its period, or those added to the library. */ covers: "published" | "added"; /** Digests are going out: on and not paused. Only then is a next edition promised. */ sending: boolean; /** An editor publishes each digest, so the next one has a day and no time. */ approval: boolean; timezone: string; schedule: string};
type Base = {settings: DigestSettings; base: string};
type ArchiveProps = {view: "archive"; latest: Promise<DigestSummary | null>; editions: Promise<DigestArchivePage>; chart: Promise<DigestChart>; nextEdition: Promise<DigestDate | null>};
export type EditionCardsData = {cards: ListItem[]; cited: CitedPublicationsByKey; profiles: AuthorProfile[]};
type EditionProps = {view: "edition"; slug: string; earlier: Promise<DigestSummary[]>; edition: Promise<DigestEdition | undefined>; cards: Promise<EditionCardsData>};
type PreferencesProps = {view: "preferences"; token: Promise<string>; subscriber: Promise<Preferences | null>};

// The page structure comes from the library configuration the client already
// has. Only the parts that read digest rows wait, each behind its own
// placeholder. Links between digest pages prefetch the whole page, data
// included, so an edition opened from the list is already complete.
const NOT_SENDING = "This library is not sending digests at the moment.";

/** What the library's settings mean for these pages. A library that is not sending digests names no day for the next one, here or beside the choice to subscribe. */
function useDigestSettings(locale: string): DigestSettings {
  const {identity, notifications} = useLibraryConfig();
  const sending = notifications.enabled && notifications.pausedSince === null;
  const schedule = sending ? describeDigestSchedule(notifications.schedule, locale, notifications.approval) : NOT_SENDING;
  return {libraryName: identity.name, enabled: notifications.enabled, covers: notifications.digestCovers, sending, approval: notifications.approval, timezone: notifications.schedule.timezone, schedule};
}

export default function DigestPages(props: ArchiveProps | EditionProps | PreferencesProps) {
  const locale = useLocale(); const base = "/digests";
  const settings = useDigestSettings(locale);
  if (props.view === "preferences") return <DigestPreferences {...props} settings={settings} base={base} />;
  if (props.view === "archive") return <DigestArchive {...props} settings={settings} base={base} locale={locale} />;
  return <DigestDetail {...props} settings={settings} base={base} />;
}

function DigestPreferences({settings, token, subscriber, base}: PreferencesProps & Base) {
  return <PageContainer className="mx-auto max-w-3xl"><TextLink href={base} back>Digests</TextLink><header className="mb-8 mt-7"><h1 className="text-3xl font-bold">Email preferences</h1><p className={`mt-3 text-sm ${muted}`}>Change your subscriptions to this library.</p></header>
    <Suspense fallback={<Skeleton className="h-44 rounded-2xl" />}><SubscriberPreferences subscriber={subscriber} token={token} schedule={settings.schedule} /></Suspense>
  </PageContainer>;
}
function SubscriberPreferences({subscriber, token: pending, schedule}: {subscriber: Promise<Preferences | null>; token: Promise<string>; schedule: string}) {
  const initial = use(subscriber);
  const token = use(pending);
  if (!initial) notFound();
  return <Subscription key="preferences" initial={initial} preferences token={token} schedule={schedule} />;
}

/** Content beside a 320 px rail, as the library page lays out its results and sidebar. */
const withRail = "grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12";

function DigestArchive({settings, latest, editions, chart, nextEdition, base, locale}: ArchiveProps & Base & {locale: string}) {
  return <PageContainer className="mx-auto relative z-0 -mt-6 overflow-visible pt-0 lg:pt-0 xl:pt-0">
      <header className={`${styles.hero} relative isolate mb-12 grid items-center gap-8 px-0 pb-12 pt-16 lg:grid-cols-[1fr_0.9fr] lg:gap-14 lg:pb-16 lg:pt-20`}>
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-1/2 -top-[100vh] -z-10 w-screen -translate-x-1/2 bg-card_light dark:bg-card" />
        <div className="max-w-lg">
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">Library<br />digests</h1>
          <p className="mt-5 max-w-sm text-base leading-7 text-black/60 dark:text-white/60">{settings.covers === "published" ? "Summaries of the publications in this library, one period at a time." : "Summaries of new publications in this library."}</p>
          {settings.sending && <Suspense fallback={<NextEditionLoading />}><NextEdition nextEdition={nextEdition} settings={settings} /></Suspense>}
        </div>
        <Suspense fallback={<Skeleton className={`mx-auto ${coverHeight} w-full max-w-md rounded-2xl`} />}><FeaturedEdition latest={latest} nextEdition={nextEdition} settings={settings} base={base} locale={locale} /></Suspense>
      </header>
      <div className={withRail}>
        <section id="archive" aria-label="Digest archive" className="min-w-0 scroll-mt-8">
          <Suspense fallback={<ArchiveLoading />}><ArchiveList editions={editions} nextEdition={nextEdition} settings={settings} base={base} locale={locale} /></Suspense>
        </section>
        <aside className="space-y-4 lg:sticky lg:top-8">
          <Suspense fallback={<Skeleton className="h-[19rem] rounded-2xl" />}><EditionsChart chart={chart} base={base} locale={locale} /></Suspense>
          {settings.enabled && <Subscription initial={newReader} schedule={settings.schedule} />}
        </aside>
      </div>
  </PageContainer>;
}
/** The next send date as a tile, like the archive's. The tile sets the height, so the text beside it never moves the page. */
const nextEditionRow = "mt-5 flex h-[4.25rem] items-center gap-4";
function NextEditionLoading() {
  return <div className={nextEditionRow}><Skeleton className="h-full w-16 rounded-xl" /><div className="space-y-2"><Skeleton className="h-3 w-24 rounded-lg" /><Skeleton className="h-5 w-44 rounded-lg" /><Skeleton className="h-3 w-28 rounded-lg" /></div></div>;
}
function NextEdition({nextEdition, settings}: {nextEdition: Promise<DigestDate | null>; settings: DigestSettings}) {
  const next = use(nextEdition);
  if (!next) return null;
  return <div className={nextEditionRow}>
    <time dateTime={next.at} aria-label={next.weekday} className="grid h-full w-16 shrink-0 place-content-center rounded-xl bg-accent/10 text-center text-accent"><span className="block text-2xl font-semibold leading-none tabular-nums">{Number(next.day)}</span><span className="mt-2 block text-xs">{next.month}</span></time>
    <div className="w-0 flex-1"><p className={`truncate text-xs ${muted}`}>Next edition</p><p className="mt-1 truncate font-medium">{settings.approval ? next.dayName : `${next.dayName} at ${next.time}`}</p><TruncatedText text={settings.approval ? "Once an editor has checked it" : timeZoneLabel(settings.timezone)} className={`mt-0.5 text-xs ${muted}`} /></div>
  </div>;
}

/** One edition in a list: its date in a gutter, then its title and opening. The archive and an edition's "More digests" share it. */
function EditionRow({item, base, locale, summary = true}: {item: DigestSummary; base: string; locale: string; summary?: boolean}) {
  return <Link href={`${base}/${item.slug}`} prefetch className="group grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-4 rounded-xl p-4 outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-white/5 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-6">
    <PeriodTile period={item.period} />
    <div className="min-w-0">
      <h3 className="font-heading text-xl font-medium leading-snug transition-colors group-hover:text-accent">{item.title}</h3>
      {summary && <MarkdownExcerpt className={`mt-1.5 line-clamp-2 text-sm leading-6 ${muted}`}>{item.summary}</MarkdownExcerpt>}
      <span className={`mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs ${muted}`}><span className="inline-flex items-center gap-1.5"><Icon value={BookOpen01Icon} size={14} />{publicationCount(item.publicationCount, locale)}</span><Attribution by={item.by} /></span>
    </div>
  </Link>;
}
/** An edition's days as a tile: the first to the last day it covers over their month. */
function PeriodTile({period}: {period: DigestPeriod}) {
  return <time dateTime={period.first} aria-label={period.label} className="pt-0.5 text-center"><span className="block whitespace-nowrap font-heading text-2xl font-semibold leading-none tabular-nums sm:text-[1.65rem]">{period.days}</span><span className={`mt-1.5 block text-xs ${muted}`}>{period.months}</span></time>;
}
/** Editions under the year their period ends in, each year one card of rows. */
function byYear(items: DigestSummary[]) {
  const years: {year: string; items: DigestSummary[]}[] = [];
  for (const item of items) {
    const year = item.period.year;
    if (years.at(-1)?.year === year) years.at(-1)!.items.push(item);
    else years.push({year, items: [item]});
  }
  return years;
}
const rowCard = "rounded-2xl bg-card_light p-2 dark:bg-card";
function ArchiveLoading() {
  return <div className={rowCard}>{[0, 1, 2].map(index => <div key={index} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-6 p-4"><Skeleton className="mx-auto h-10 w-10 rounded-lg" /><div className="space-y-3"><Skeleton className="h-5 w-3/5 rounded-lg" /><Skeleton className="h-3 w-full rounded-lg" /><Skeleton className="h-3 w-24 rounded-lg" /></div></div>)}</div>;
}
function ArchiveList({editions, nextEdition, settings, base, locale}: {editions: Promise<DigestArchivePage>; nextEdition: Promise<DigestDate | null>; settings: DigestSettings; base: string; locale: string}) {
  const {editions: items, page, pages} = use(editions);
  if (!items.length) return <EmptyArchive next={settings.sending ? use(nextEdition) : null} settings={settings} />;
  return <Paged page={page} pages={pages} href={next => next > 1 ? `${base}?page=${next}` : base} anchor="archive"><div className="space-y-8">
    {byYear(items).map(({year, items: ofYear}) => <section key={year} aria-labelledby={`year-${year}`}>
      <SectionTitle className="mb-3 text-xl"><span id={`year-${year}`}>{year}</span></SectionTitle>
      <div className={rowCard}>{ofYear.map(item => <EditionRow key={item.slug} item={item} base={base} locale={locale} />)}</div>
    </section>)}
  </div></Paged>;
}

/** The bar read out: the one pointed at while it is on this page, else the latest. A page turned while pointing can show fewer bars. */
const chartFocus = (pointed: number | null, count: number) => (pointed !== null && pointed < count ? pointed : count - 1);
/** The Editions card before the first edition: the same parts, so the card below it stays where it is. */
function EmptyEditionsChart() {
  return <SidebarCard title="Editions" aside={<span className={`text-sm tabular-nums ${muted}`}>0</span>} band={<>
    <HeadFigure value="0" label="publications" />
    <div aria-hidden className="h-24 border-b-2 border-dashed border-accent/30" />
  </>}>
    <div className="-mt-1 h-[4.25rem]"><p className={`text-sm ${muted}`}>No editions yet</p></div>
  </SidebarCard>;
}
/** Publications per edition, oldest first, as the library's Years card shows publications per year. Pointing at a bar reads it out; the latest is read out otherwise. */
function EditionsChart({chart, base, locale}: {chart: Promise<DigestChart>; base: string; locale: string}) {
  const {editions: items, total} = use(chart);
  const [pointed, setPointed] = useState<number | null>(null);
  if (!items.length) return <EmptyEditionsChart />;
  const shown = items.toReversed();
  const largest = Math.max(...shown.map(item => item.publicationCount));
  const focus = chartFocus(pointed, shown.length);
  const edition = shown[focus];
  return <SidebarCard title="Editions" aside={<span className={`text-sm tabular-nums ${muted}`}>{total.toLocaleString(locale)}</span>} band={<>
    <HeadFigure value={edition.publicationCount.toLocaleString(locale)} label="publications" />
    <div className="flex h-24 items-end gap-1" onMouseLeave={() => setPointed(null)}>
      {shown.map((item, index) => <Link key={item.slug} href={`${base}/${item.slug}`} prefetch aria-label={`${item.title}, ${publicationCount(item.publicationCount, locale)}`} onMouseEnter={() => setPointed(index)} onFocus={() => setPointed(index)} onBlur={() => setPointed(null)} className="flex h-full flex-1 items-end rounded-t-[3px] outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className={twMerge("block w-full rounded-t-[3px] transition-colors duration-200 motion-reduce:transition-none", index === focus ? "bg-accent" : "bg-accent/30")} style={{height: barWidth(item.publicationCount, largest)}} />
      </Link>)}
    </div>
  </>}>
    <div className="-mt-1 h-[4.25rem]"><p className={`text-xs ${muted}`}>{edition.period.label}</p><p className="mt-1 line-clamp-2 font-medium leading-6">{edition.title}</p></div>
  </SidebarCard>;
}

/** Before the first edition: the first row is kept for it, dated when it is scheduled, and the rows after it wait faintly below. */
function EmptyArchive({next, settings}: {next: DigestDate | null; settings: DigestSettings}) {
  // A library that sends no digests is not promised an edition.
  const [title, text] = settings.sending
    ? ["Editions will collect here", `${settings.covers === "published" ? "Each digest sums up the publications dated in its period." : "Each digest sums up the publications added since the one before."} ${firstEdition(next)}`]
    : ["No editions yet", NOT_SENDING];
  const tile = "rounded-xl px-1 py-3 text-center";
  const row = "grid grid-cols-[56px_minmax(0,1fr)] items-start gap-4 rounded-2xl p-5 sm:grid-cols-[64px_minmax(0,1fr)] sm:gap-5";
  return <div>
    <div className={`${row} border-2 border-dashed border-accent/35`}>
      {next
        ? <time dateTime={next.at} className={`${tile} bg-accent/10 text-accent`}><span className="block text-2xl font-semibold leading-none tabular-nums">{Number(next.day)}</span><span className="mt-2 block text-xs">{next.month}</span></time>
        : <span aria-hidden="true" className={`${tile} grid h-[4.25rem] place-items-center bg-accent/10 text-accent`}><Icon value={Notification03Icon} size={22} /></span>}
      <div>
        <h2 className="text-xl font-semibold leading-snug">{title}</h2>
        <p className={`mt-2 text-sm leading-6 ${muted}`}>{text}</p>
      </div>
    </div>
    <div aria-hidden="true" className="mt-3 space-y-3 [mask-image:linear-gradient(to_bottom,black,transparent)]">
      {[0, 1].map(index => <div key={index} className={`${row} bg-card_light dark:bg-card`}>
        <span className={`${tile} h-[4.25rem] bg-black/[0.04] dark:bg-white/[0.04]`} />
        <div className="space-y-3 pt-1"><span className="block h-4 w-3/5 rounded-full bg-black/[0.06] dark:bg-white/[0.07]" /><span className="block h-3 w-full rounded-full bg-black/[0.04] dark:bg-white/[0.05]" /><span className="block h-3 w-4/5 rounded-full bg-black/[0.04] dark:bg-white/[0.05]" /></div>
      </div>)}
    </div>
  </div>;
}

function firstEdition(next: DigestDate | null) {
  // A send date with nothing to cover is skipped, so the date is only when the first one is due.
  return next ? `The first is due on ${next.weekday}, if there are publications to cover by then.` : "The first will appear when there are publications to cover.";
}

function DigestDetail({settings, slug, earlier, edition, cards, base}: EditionProps & Base) {
  const locale = useLocale();
  return <PageContainer className="mx-auto overflow-clip">
      <TextLink href={base} back>All digests</TextLink>
      {/* One boundary for the edition and the digests after it: they appear together, so nothing below the text moves when it arrives. */}
      <Suspense fallback={<EditionLoading />}>
        <EditionBody edition={edition} cards={cards} path={`${base}/${slug}`} />
        {/* Both cards stretch to the taller one, so they start and end on the same lines. */}
        <div className={twMerge(`mt-20 ${withRail}`, "items-stretch")}>
          <div className="min-w-0 [&>section]:h-full">
            <SidebarCard title="More digests" aside={<TextLink href={base}>Browse all digests</TextLink>}>
              <PastDigests earlier={earlier} base={base} locale={locale} />
            </SidebarCard>
          </div>
          {settings.enabled && <Subscription initial={newReader} schedule={settings.schedule} />}
        </div>
      </Suspense>
  </PageContainer>;
}
function EditionLoading() {
  // At least a screen tall, as every edition is: the footer stays below the fold instead of jumping down when the edition arrives.
  return <div aria-hidden="true" className="mt-8 min-h-screen">
    <div className="mb-12 max-w-3xl space-y-5"><Skeleton className="h-11 w-3/4 rounded-xl" /><Skeleton className="h-5 w-full rounded-lg" /><Skeleton className="h-4 w-64 rounded-lg" /></div>
    <div className={withRail}><div className="space-y-3"><Skeleton className="h-4 w-full rounded-lg" /><Skeleton className="h-4 w-full rounded-lg" /><Skeleton className="h-4 w-4/5 rounded-lg" /></div><Skeleton className="h-80 rounded-2xl" /></div>
  </div>;
}
function EditionBody({edition: pending, cards, path}: {edition: Promise<DigestEdition | undefined>; cards: Promise<EditionCardsData>; path: string}) {
  const edition = use(pending);
  // The records arrive with the text: a placeholder card cannot know how tall each real one is, so a list that
  // filled in afterwards moved the page.
  const records = use(cards);
  const locale = useLocale();
  if (!edition) notFound();
  const {intro, parts} = editionParts(edition.markdown);
  const listAnchor = edition.reviews ? "reviews" : "publications";
  return <>
    <EditionHeader edition={edition} />
    <div className={withRail}>
      <article className="min-w-0">
        <EditorNote edition={edition} />
        <CitedPublications value={records.cited}>
          {intro && <AIMarkdown>{intro}</AIMarkdown>}
          <div className="space-y-12">{parts.map(part => <section key={part.id} id={part.id} aria-labelledby={`${part.id}-title`} className="scroll-mt-8">
            <SectionTitle className="mb-4"><span id={`${part.id}-title`}>{part.title}</span></SectionTitle>
            <AIMarkdown>{part.body}</AIMarkdown>
          </section>)}</div>
        </CitedPublications>
        <InThisEdition edition={edition} records={records} path={path} locale={locale} />
      </article>
      {/* The publications scroll away with the page; the contents, last in the rail, stay in view to move between sections. */}
      <aside className="order-first flex flex-col gap-4 lg:order-none lg:self-stretch">
        <EditionShare edition={edition} locale={locale} />
        <div className="lg:sticky lg:top-8"><Contents parts={parts} edition={edition} listAnchor={listAnchor} locale={locale} /></div>
      </aside>
    </div>
  </>;
}

function EditionHeader({edition}: {edition: DigestEdition}) {
  return <header className="mb-12 mt-8 max-w-4xl">
    <h1 className="font-heading text-4xl font-semibold leading-[1.1] tracking-tight text-balance sm:text-5xl">{edition.title}</h1>
    <MarkdownExcerpt className={`mt-5 max-w-3xl text-lg leading-8 ${muted}`}>{edition.summary}</MarkdownExcerpt>
    <div className="mt-6"><EditionMeta edition={edition} /></div>
  </header>;
}
/** The edition's publications under their heading, with how many of the period's are listed and how they were chosen. */
function InThisEdition({edition, records, path, locale}: {edition: DigestEdition; records: EditionCardsData; path: string; locale: string}) {
  return <section id="publications" className="mt-16 scroll-mt-8" aria-labelledby="publications-title">
    <SectionTitle className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><span id="publications-title">In this edition</span><span className={`text-sm font-normal tabular-nums ${muted}`}><CountHint edition={edition} locale={locale}>{edition.listed.toLocaleString(locale)} of {edition.publicationCount.toLocaleString(locale)}</CountHint></span></SectionTitle>
    <HowChosen edition={edition} locale={locale} />
    <EditionLists edition={edition} records={records} path={path} locale={locale} />
  </section>;
}

/** The section the reader is in: the first section crossing a band near the top of the window. Kept while the reader is between two sections. */
function useActiveSection(ids: string[]) {
  const key = ids.join(" ");
  const [active, setActive] = useState<string | null>(null);
  // IntersectionObserver: where the reader is in the edition, for the contents list.
  useEffect(() => {
    const watched = key.split(" ").filter(Boolean);
    const crossing = new Map<string, boolean>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) crossing.set(entry.target.id, entry.isIntersecting);
      const first = watched.find(id => crossing.get(id));
      if (first) setActive(first);
    }, {rootMargin: "-24px 0px -70% 0px"});
    for (const id of watched) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [key]);
  return active ?? key.split(" ")[0] ?? null;
}
const railRow = "flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-white/5";
/** The edition's subjects and its publication list, each with how many publications it cites, the one being read marked. */
function Contents({parts, edition, listAnchor, locale}: {parts: Part[]; edition: DigestEdition; listAnchor: string; locale: string}) {
  const active = useActiveSection([...parts.map(part => part.id), "publications"]);
  const rows = [...parts.map(part => ({id: part.id, href: part.id, title: part.title, count: part.cited, word: "cited"})), {id: "publications", href: listAnchor, title: "In this edition", count: edition.listed, word: "listed"}];
  if (!parts.length) return null;
  return <SidebarCard title="Contents">
    <ul className="-mx-3 -my-2 flex flex-col">{rows.map(row => <li key={row.id}>
      <a href={`#${row.href}`} aria-current={active === row.id ? "location" : undefined} className={twMerge(railRow, active === row.id && "bg-black/5 font-medium text-accent dark:bg-white/5")}>
        <span className="min-w-0 flex-1 leading-5">{row.title}</span>
        <span className={`shrink-0 text-xs tabular-nums ${muted}`}>{row.count.toLocaleString(locale)} {row.word}</span>
      </a>
    </li>)}</ul>
  </SidebarCard>;
}
/** Records not read yet, in the bar and beside their count: an outline, since their type is not known. */
const UNREAD_TONE = "border border-dashed border-black/35 dark:border-white/40";
/** How many of a study type a count holds; none when it was not counted. */
const share = (counts: DigestTypeCounts | null, key: keyof DigestTypeCounts) => counts?.[key] ?? 0;
type TypeShare = {type: (typeof STUDY_TYPES)[number]; listed: number; period: number | null};

/** Each type the edition lists or its period had: how many it lists, and how many the period had, null when not counted. */
function typeShares({listed, period}: EditionTypes): TypeShare[] {
  return STUDY_TYPES.map(type => ({type, listed: share(listed, type.key), period: period && share(period, type.key)}))
    .filter(row => row.listed > 0 || Boolean(row.period));
}

/** Where a level's rows lead: its own list, or the one list of an edition without reviews. */
function levelList(edition: DigestEdition, level: StudyLevel) {
  if (!edition.reviews) return "#publications";
  return level === "synthesis" ? "#reviews" : "#other-publications";
}

/**
 * The edition's list by study type under the three levels of evidence: for each type, how many are listed of how many
 * the period had when the list was made. The bar is the listed records by type; its empty track is the rest of the
 * period. A digest listed before types were read has no period counts, and shows what it lists.
 */
function EditionShare({edition, locale}: {edition: DigestEdition; locale: string}) {
  const rows = typeShares(edition.types);
  const n = (count: number) => count.toLocaleString(locale);
  const unread = share(edition.types.listed, "unread");
  const label = edition.listed < edition.publicationCount ? `listed of ${n(edition.publicationCount)} in this period` : "listed, every one in this period";
  // The whole figure opens the count's card, beside the rail rather than over it; only its words carry the hint's underline.
  const figure = <Tooltip content={<CountCard edition={edition} locale={locale} />} placement="left" className={headerHint.contentClassName}>
    <div tabIndex={0} className="cursor-help rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"><HeadFigure value={n(edition.listed)} label={<span className={HINT_UNDERLINE}>{label}</span>} /></div>
  </Tooltip>;
  return <SidebarCard title="Publications" band={<ShareBand rows={rows} unread={unread} listed={edition.listed} total={edition.publicationCount} figure={figure} />}>
    <ShareLevels rows={rows} href={level => levelList(edition, level)} n={n} />
    <UnreadShare listed={unread} period={edition.types.period && share(edition.types.period, "unread")} n={n} />
  </SidebarCard>;
}

/** How many the edition lists of the period's, and a bar of the listed records by type, those not read yet last. */
function ShareBand({rows, unread, listed, total, figure}: {rows: TypeShare[]; unread: number; listed: number; total: number; figure: ReactNode}) {
  return <>
    {figure}
    <div aria-hidden className="flex h-3 gap-[2px] overflow-hidden rounded-full">{rows.filter(row => row.listed > 0).map(row => <span key={row.type.key} className={`h-full min-w-[3px] ${studyTone(row.type.key)}`} style={{width: `${(row.listed / total) * 100}%`}} />)}{unread > 0 && <span className={`h-full min-w-[3px] rounded-[2px] ${UNREAD_TONE}`} style={{width: `${(unread / total) * 100}%`}} />}{listed < total && <span className="h-full min-w-[3px] flex-1 bg-black/10 dark:bg-white/15" />}</div>
  </>;
}

/** How many of a set of types are listed, and how many the period had; null when the period was not counted by type. */
function totalShare(rows: TypeShare[]) {
  return {listed: rows.reduce((sum, row) => sum + row.listed, 0), period: rows.some(row => row.period === null) ? null : rows.reduce((sum, row) => sum + (row.period ?? 0), 0)};
}

/**
 * The reviews and syntheses type by type, since readers start there, then the primary studies and the other work as a
 * row each, their types on hover. Each row opens the list it is in.
 */
function ShareLevels({rows, href, n}: {rows: TypeShare[]; href: (level: StudyLevel) => string; n: (count: number) => string}) {
  const t = useTranslations("studyTypes");
  const syntheses = rows.filter(row => row.type.level === "synthesis");
  const folded = STUDY_LEVELS.filter(level => level.key !== "synthesis").map(level => ({level, rows: rows.filter(row => row.type.level === level.key)})).filter(group => group.rows.length);
  return <div className="-mx-3 -my-2 flex flex-col gap-3">
    {syntheses.length > 0 && <section aria-label={t("levels.synthesis")}>
      <h5 className={`px-3 pb-1 text-xs ${muted}`}>{t("levels.synthesis")}</h5>
      <ul className="flex flex-col">{syntheses.map(row => <TypeShareRow key={row.type.key} tone={studyTone(row.type.key)} label={t(`types.${row.type.key}.plural`)} href={href("synthesis")} listed={n(row.listed)} inPeriod={row.period === null ? null : n(row.period)} />)}</ul>
    </section>}
    {folded.length > 0 && <ul className="flex flex-col">{folded.map(({level, rows: types}) => {
      const total = totalShare(types);
      return <TypeShareRow key={level.key} tone={studyTone(types[0]!.type.key)} label={t(`levels.${level.key}`)} href={href(level.key)} listed={n(total.listed)} inPeriod={total.period === null ? null : n(total.period)}
        hint={<LevelTypes name={t(`levels.${level.key}`)} rows={types} n={n} />} />;
    })}</ul>}
  </div>;
}

/** A folded level's types, on hover: each with its swatch and how many are listed of the period's. */
function LevelTypes({name, rows, n}: {name: string; rows: TypeShare[]; n: (count: number) => string}) {
  const t = useTranslations("studyTypes");
  return <span className="flex flex-col gap-2">
    <span className="font-medium">{name}</span>
    <ul className="flex flex-col gap-1.5">{rows.map(row => <li key={row.type.key} className="flex items-center gap-2.5">
      <span aria-hidden className={`size-2.5 shrink-0 rounded-[3px] ${studyTone(row.type.key)}`} />
      <span className="min-w-0 flex-1">{t(`types.${row.type.key}.plural`)}</span>
      <span className="shrink-0 tabular-nums"><span className="font-semibold">{n(row.listed)}</span>{row.period !== null && <span className={muted}> of {n(row.period)}</span>}</span>
    </li>)}</ul>
  </span>;
}

/** One row of the Publications card: its swatch, its name, how many are listed of the period's, and on hover its parts. */
function TypeShareRow({tone, label, href, listed, inPeriod, hint}: {tone: string; label: string; href: string; listed: string; inPeriod: string | null; hint?: ReactNode}) {
  const row = <a href={href} className={railRow}>
    <span aria-hidden className={`size-2.5 shrink-0 rounded-[3px] ${tone}`} />
    <span className="min-w-0 flex-1 truncate">{label}</span>
    <span className="shrink-0 text-sm tabular-nums"><span className="font-semibold">{listed}</span>{inPeriod !== null && <span className={muted}> of {inPeriod}</span>}</span>
  </a>;
  return <li>{hint ? <Tooltip content={hint} placement="left" className="min-w-64 p-3 text-sm">{row}</Tooltip> : row}</li>;
}

/** The records not read yet when the list was made, apart from the types, as the library's Study types card counts them. */
function UnreadShare({listed, period, n}: {listed: number; period: number | null; n: (count: number) => string}) {
  const t = useTranslations("studyTypes");
  if (!listed && !period) return null;
  return <p className="mt-4 flex items-baseline justify-between gap-4 border-t border-black/5 pt-3 text-sm dark:border-white/10">
    <span className="flex items-center gap-3 font-medium"><span aria-hidden className={`size-2.5 shrink-0 rounded-[3px] ${UNREAD_TONE}`} />{t("notRead")}</span>
    <span className="tabular-nums"><span className="font-semibold">{n(listed)}</span>{period !== null && <span className={muted}> of {n(period)}</span>}</span>
  </p>;
}

/** The score's parts, as `rankPublications` adds them up. */
const SCORE = [
  ["+3", "Published in a journal or series on the CWTS Core list, the sources behind the Leiden Ranking"],
  ["+2", "Ten or more references that OpenAlex matched, or +1 for one to nine"],
  ["+1", "At least one author's institution on record"],
  ["+2 × ln(1 + n)", "n citations in OpenAlex, about +5 for 10 and +9 for 100"],
  ["−1", "A dataset or software"],
] as const;
/** Each question of "How this edition was made" says its answer in a line, so the card reads at a glance while closed. */
const FAQ_ITEM = {
  base: "px-0",
  trigger: "gap-4 py-4 data-[focus-visible=true]:outline-accent",
  title: "font-medium leading-6",
  subtitle: `mt-0.5 text-sm leading-6 ${muted}`,
  indicator: "text-black/40 dark:text-white/40",
  content: "pb-5 pt-0 text-sm leading-6 text-black/70 dark:text-white/70",
};

/**
 * How the edition was made, as the questions a reader asks of it: what the AI read, why these publications are listed
 * in this order (`reviewStanding`, then an abstract, then the score), what is left out, and how the text was checked.
 */
function HowChosen({edition, locale}: {edition: DigestEdition; locale: string}) {
  const reducedMotion = useReducedMotion();
  const n = (count: number) => count.toLocaleString(locale);
  const cut = edition.read < edition.publicationCount;
  // A record hidden after the edition was written leaves its list, so the list can be shorter than what was read.
  const hidden = edition.read - edition.listed;
  const steps: {title: string; text: string; score?: true}[] = [
    {title: "Reviews and syntheses", text: "Reviews of reviews, meta-analyses, systematic reviews, narrative reviews and bibliometric studies come first. Each paper's study type is the one an AI model read when it entered the library, or an editor's correction."},
    {title: "An abstract of 200 characters or more", text: "The writer works from abstracts, so papers with one come before papers without."},
    {title: "A score", text: "Then papers are ranked by the sum of:", score: true},
  ];
  return <div className="mb-10 rounded-2xl bg-card_light px-6 pt-5 pb-1 dark:bg-card">
    <h3 className="font-heading text-lg font-medium">How this edition was made</h3>
    <Accordion selectionMode="multiple" className="mt-1 px-0" itemClasses={FAQ_ITEM} disableAnimation={Boolean(reducedMotion)}>
      <AccordionItem key="read" aria-label="What did the AI read?" title="What did the AI read?" motionProps={{variants: ACCORDION_CONTENT_MOTION}}
        subtitle={`The titles and abstracts of ${cut ? n(edition.read) : "all"} of the period's ${n(edition.publicationCount)} publications. The text cites ${n(edition.cited)}.`}>
        <p>{cut
          ? `It reads at most 1,000 publications or 1.5 MB of text, so a period with more is cut to the ${n(edition.read)} that rank highest, in the order below.`
          : "It read every publication dated in this period, and they are listed in the order below."}{hidden > 0 && ` Since then the library has taken ${n(hidden)} of them down, so ${n(edition.listed)} are listed.`}</p>
      </AccordionItem>
      <AccordionItem key="order" aria-label="Why these publications, in this order?" title="Why these publications, in this order?" motionProps={{variants: ACCORDION_CONTENT_MOTION}}
        subtitle="Reviews and syntheses first, then those with an abstract, then by a score.">
        <ol className="flex flex-col gap-4">{steps.map((step, index) => <li key={step.title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
          <span aria-hidden className="grid size-7 place-content-center rounded-full bg-accent/10 text-sm font-semibold tabular-nums text-accent">{index + 1}</span>
          <div className="pt-0.5">
            <p className="font-medium leading-6 text-black dark:text-white">{step.title}</p>
            <p className={`mt-0.5 ${muted}`}>{step.text}</p>
            {step.score && <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5">{SCORE.map(([weight, what]) => <Fragment key={weight}>
              <dt className="font-semibold tabular-nums text-accent">{weight}</dt><dd>{what}</dd>
            </Fragment>)}</dl>}
          </div>
        </li>)}</ol>
      </AccordionItem>
      <AccordionItem key="left-out" aria-label="What is left out?" title="What is left out?" motionProps={{variants: ACCORDION_CONTENT_MOTION}}
        subtitle="Retracted papers, journal front matter, and a second record of the same paper.">
        <p>{"Retracted papers, as Retraction Watch reports them through OpenAlex, and journal front matter are never counted or listed. Two records with the same title, 25 characters or longer, and the same first author's surname count as one paper, such as a preprint and its article under one title."}</p>
      </AccordionItem>
      <AccordionItem key="checked" aria-label="How was the text checked?" title="How was the text checked?" motionProps={{variants: ACCORDION_CONTENT_MOTION}}
        subtitle={`A second AI model checked every sentence about a paper${edition.by ? `, and ${edition.by.name} read it before it was published` : ""}.`}>
        <p>{"AI wrote the text from these titles and abstracts, not from the full papers. Once it is written, OpenScholar asks a second AI model, from another company, to check each sentence about a paper against that paper's title and abstract, and the writer corrects or removes what it flags."}{edition.by && ` ${edition.by.name} checked the text before it was published.`}</p>
      </AccordionItem>
    </Accordion>
  </div>;
}

/** The edition's publications: its reviews and syntheses first as a list of their own, by type, then the others, each with its own pages. */
function EditionLists({edition, records, path, locale}: {edition: DigestEdition; records: EditionCardsData; path: string; locale: string}) {
  const {reviews} = edition;
  const list = (anchor: string, keys: string[], page: number, pages: number, href: (next: number) => string) => <Paged page={page} pages={pages} href={href} anchor={anchor}>
    <EditionCards records={records} keys={keys} />
  </Paged>;
  if (!reviews) return list("publications", edition.keys, edition.page, edition.pages, next => address(path, next));
  return <>
    <ListHeading id="reviews" title="Reviews and syntheses" count={reviews.listed} locale={locale} />
    {list("reviews", reviews.keys, reviews.page, reviews.pages, next => address(path, edition.page, next))}
    <div className="mt-12"><ListHeading id="other-publications" title="Other publications" count={edition.listed - reviews.listed} locale={locale} /></div>
    {list("other-publications", edition.keys, edition.page, edition.pages, next => address(path, next, reviews.page))}
  </>;
}
/** One card per row, as the library's results list shows records. */
const cardList = "flex flex-col gap-4";
/** An edition page's address: each list keeps the page the other is on. */
function address(path: string, page: number, reviews = 1) {
  const query = new URLSearchParams();
  if (page > 1) query.set("page", String(page));
  if (reviews > 1) query.set("reviews", String(reviews));
  return query.size ? `${path}?${query}` : path;
}
function ListHeading({id, title, count, locale}: {id: string; title: string; count: number; locale: string}) {
  return <h3 id={id} className="mb-4 flex scroll-mt-8 items-baseline gap-2 font-heading text-xl font-medium">{title}<span className={`text-sm font-normal tabular-nums ${muted}`}>{count.toLocaleString(locale)}</span></h3>;
}
function EditionCards({records: {cards, profiles}, keys}: {records: EditionCardsData; /** The cards of one list, in its order. */ keys: string[]}) {
  const listed = keys.flatMap(key => cards.find(card => card.key === key) ?? []);
  // The server read the authors with the cards, so no card looks them up on its own.
  return <AuthorProfilesContext value={new Map(profiles.map(profile => [profile.id, profile]))}>
    <div className={cardList}>{listed.map(card => <Resource key={card.key} as="div" abstract hideUnapi itemData={card} />)}</div>
  </AuthorProfilesContext>;
}
function PastDigests({earlier, base, locale}: {earlier: Promise<DigestSummary[]>; base: string; locale: string}) {
  const older = use(earlier);
  if (!older.length) return <p className={`text-sm ${muted}`}>This is the first edition.</p>;
  return <div className="-mx-4 -my-3">{older.map(item => <EditionRow key={item.slug} item={item} base={base} locale={locale} summary={false} />)}</div>;
}

function FeaturedEdition({latest, nextEdition, settings, base, locale}: {latest: Promise<DigestSummary | null>; nextEdition: Promise<DigestDate | null>; settings: DigestSettings; base: string; locale: string}) {
  const edition = use(latest);
  const next = use(nextEdition);
  return edition
    ? <DigestCover edition={edition} libraryName={settings.libraryName} href={`${base}/${edition.slug}`} locale={locale} />
    : <FirstEditionCover libraryName={settings.libraryName} sending={settings.sending} next={settings.sending ? next : null} />;
}
