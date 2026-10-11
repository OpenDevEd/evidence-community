"use client";

import { Suspense, use, useEffect, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { notFound } from "next/navigation";
import { Link, useRouter } from "@/i18n/routing";
import PageContainer from "@/components/layout/PageContainer";
import { AiMagicIcon, Calendar03Icon, BookOpen01Icon, Notification03Icon } from "@hugeicons/core-free-icons";
import type { DigestArchivePage, DigestDate, DigestEdition, DigestSignature, DigestSummary } from "@/lib/notifications/public";
import type { ListItem } from "@/app/api/item/types";
import { AuthorProfilesContext } from "@/lib/authors/use-author-profiles";
import type { AuthorProfile } from "@/lib/authors/profiles";
import { Pagination } from "@/components/nextui/Pagination";
import { describeDigestSchedule, timeZoneLabel } from "@/lib/notifications/schedule";
import { DIGEST_SIGNER_ROLE } from "@/lib/notifications/types";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { Skeleton } from "@/components/nextui/Skeleton";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { twMerge } from "@/lib/tw-merge";
import styles from "./DigestPages.module.css";
import Resource from "@/components/features/items/Resource";
import { HeadFigure, SidebarCard, barWidth } from "@/components/features/collections/ResultsOverview";

import { AIMarkdown, MarkdownExcerpt } from "@/components/features/markdown/Markdown";


import { SectionTitle } from "@/components/typography/SectionTitle";
import { Face, Icon, TextLink, muted } from "./DigestPrimitives";
import { DigestCover, FirstEditionCover, coverHeight, publicationCount } from "./DigestCover";
import { Subscription, type Preferences } from "./Subscription";

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
function EditionMeta({ edition }: { edition: DigestSummary }) {
  const locale = useLocale();
  return <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-sm ${muted}`}><span className="inline-flex items-center gap-1.5"><Icon value={Calendar03Icon} size={16} /><time dateTime={edition.published.at}>{edition.published.date}</time></span><span className="inline-flex items-center gap-1.5"><Icon value={BookOpen01Icon} size={16} />{publicationCount(edition.publicationCount, locale)}</span><Attribution by={edition.by} /></div>;
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

type Part = {id: string; title: string; body: string; /** Publications the section cites, each counted once. */ cited: number};
/** The edition's text cut at its subject headings, so each subject is a section the contents can point to. */
function editionParts(markdown: string): {intro: string; parts: Part[]} {
  const [intro, ...chunks] = markdown.split(/^## /m);
  const taken = new Set<string>();
  return {intro: intro.trim(), parts: chunks.map(chunk => {
    const end = chunk.indexOf("\n");
    const title = (end < 0 ? chunk : chunk.slice(0, end)).trim();
    const body = end < 0 ? "" : chunk.slice(end + 1);
    const base = `section-${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}`;
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return {id, title, body, cited: new Set(body.match(/\]\(\/lib\/[^)\s]+\)/g)).size};
  })};
}

const newReader: Preferences = {email: "", digest: true, instant: false, confirmed: false};
type DigestSettings = {libraryName: string; enabled: boolean; /** Digests are going out: on and not paused. Only then is a next edition promised. */ sending: boolean; /** An editor publishes each digest, so the next one has a day and no time. */ approval: boolean; timezone: string; schedule: string};
type Base = {settings: DigestSettings; base: string};
type ArchiveProps = {view: "archive"; latest: Promise<DigestSummary | null>; editions: Promise<DigestArchivePage>; nextEdition: Promise<DigestDate | null>};
export type EditionCardsData = {cards: ListItem[]; profiles: AuthorProfile[]};
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
  return {libraryName: identity.name, enabled: notifications.enabled, sending, approval: notifications.approval, timezone: notifications.schedule.timezone, schedule};
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

function DigestArchive({settings, latest, editions, nextEdition, base, locale}: ArchiveProps & Base & {locale: string}) {
  return <PageContainer className="mx-auto relative z-0 -mt-6 overflow-visible pt-0 lg:pt-0 xl:pt-0">
      <header className={`${styles.hero} relative isolate mb-12 grid items-center gap-8 px-0 pb-12 pt-16 lg:grid-cols-[1fr_0.9fr] lg:gap-14 lg:pb-16 lg:pt-20`}>
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-1/2 -top-[100vh] -z-10 w-screen -translate-x-1/2 bg-card_light dark:bg-card" />
        <div className="max-w-lg">
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">Library<br />digests</h1>
          <p className="mt-5 max-w-sm text-base leading-7 text-black/60 dark:text-white/60">Summaries of new publications in this library.</p>
          {settings.sending && <Suspense fallback={<NextEditionLoading />}><NextEdition nextEdition={nextEdition} settings={settings} /></Suspense>}
        </div>
        <Suspense fallback={<Skeleton className={`mx-auto ${coverHeight} w-full max-w-md rounded-2xl`} />}><FeaturedEdition latest={latest} nextEdition={nextEdition} settings={settings} base={base} locale={locale} /></Suspense>
      </header>
      <div className={withRail}>
        <section id="archive" aria-label="Digest archive" className="min-w-0 scroll-mt-8">
          <Suspense fallback={<ArchiveLoading />}><ArchiveList editions={editions} nextEdition={nextEdition} settings={settings} base={base} locale={locale} /></Suspense>
        </section>
        <aside className="space-y-4 lg:sticky lg:top-8">
          <Suspense fallback={<Skeleton className="h-[19rem] rounded-2xl" />}><EditionsChart editions={editions} base={base} locale={locale} /></Suspense>
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
    <time dateTime={item.published.at} aria-label={item.published.date} className="pt-0.5 text-center"><span className="block font-heading text-3xl font-semibold leading-none tabular-nums">{Number(item.published.day)}</span><span className={`mt-1.5 block text-xs ${muted}`}>{item.published.month}</span></time>
    <div className="min-w-0">
      <h3 className="font-heading text-xl font-medium leading-snug transition-colors group-hover:text-accent">{item.title}</h3>
      {summary && <MarkdownExcerpt className={`mt-1.5 line-clamp-2 text-sm leading-6 ${muted}`}>{item.summary}</MarkdownExcerpt>}
      <span className={`mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs ${muted}`}><span className="inline-flex items-center gap-1.5"><Icon value={BookOpen01Icon} size={14} />{publicationCount(item.publicationCount, locale)}</span><Attribution by={item.by} /></span>
    </div>
  </Link>;
}
/** Editions under the year they came out in, each year one card of rows. */
function byYear(items: DigestSummary[]) {
  const years: {year: string; items: DigestSummary[]}[] = [];
  for (const item of items) {
    const year = item.published.at.slice(0, 4);
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
      <SectionTitle className="mb-3 flex items-baseline gap-2 text-xl"><span id={`year-${year}`}>{year}</span><span className={`text-sm font-normal tabular-nums ${muted}`}>{ofYear.length}</span></SectionTitle>
      <div className={rowCard}>{ofYear.map(item => <EditionRow key={item.slug} item={item} base={base} locale={locale} />)}</div>
    </section>)}
  </div></Paged>;
}

/** Publications per edition, oldest first, as the library's Years card shows publications per year. Pointing at a bar reads it out; the latest is read out otherwise. */
function EditionsChart({editions, base, locale}: {editions: Promise<DigestArchivePage>; base: string; locale: string}) {
  const {editions: items} = use(editions);
  const [pointed, setPointed] = useState<number | null>(null);
  if (!items.length) return null;
  const shown = items.toReversed();
  const largest = Math.max(...shown.map(item => item.publicationCount));
  const focus = pointed ?? shown.length - 1;
  const edition = shown[focus];
  return <SidebarCard title="Editions" aside={<span className={`text-sm tabular-nums ${muted}`}>{items.length}</span>} band={<>
    <HeadFigure value={edition.publicationCount.toLocaleString(locale)} label="publications" />
    <div className="flex h-24 items-end gap-1" onMouseLeave={() => setPointed(null)}>
      {shown.map((item, index) => <Link key={item.slug} href={`${base}/${item.slug}`} prefetch aria-label={`${item.title}, ${publicationCount(item.publicationCount, locale)}`} onMouseEnter={() => setPointed(index)} onFocus={() => setPointed(index)} onBlur={() => setPointed(null)} className="flex h-full flex-1 items-end rounded-t-[3px] outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className={twMerge("block w-full rounded-t-[3px] transition-colors duration-200 motion-reduce:transition-none", index === focus ? "bg-accent" : "bg-accent/30")} style={{height: barWidth(item.publicationCount, largest)}} />
      </Link>)}
    </div>
  </>}>
    <div className="-mt-1 h-[4.25rem]"><p className={`text-xs ${muted}`}>{edition.published.monthYear}</p><p className="mt-1 line-clamp-2 font-medium leading-6">{edition.title}</p></div>
  </SidebarCard>;
}

/** Before the first edition: the first row is kept for it, dated when it is scheduled, and the rows after it wait faintly below. */
function EmptyArchive({next, settings}: {next: DigestDate | null; settings: DigestSettings}) {
  // A library that sends no digests is not promised an edition.
  const [title, text] = settings.sending
    ? ["Editions will collect here", `Each digest sums up the publications added since the one before. ${firstEdition(next)}`]
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
      <Suspense fallback={<EditionLoading />}><EditionBody edition={edition} cards={cards} path={`${base}/${slug}`} /></Suspense>
      {/* Both cards stretch to the taller one, so they start and end on the same lines. */}
      <div className={twMerge(`mt-20 ${withRail}`, "items-stretch")}>
        <div className="min-w-0 [&>section]:h-full">
          <SidebarCard title="More digests" aside={<TextLink href={base}>All digests</TextLink>}>
            <Suspense fallback={<div className="-mx-4 -my-3">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="m-4 h-12 rounded-lg" />)}</div>}><PastDigests earlier={earlier} base={base} locale={locale} /></Suspense>
          </SidebarCard>
        </div>
        {settings.enabled && <Subscription initial={newReader} schedule={settings.schedule} />}
      </div>
  </PageContainer>;
}
function EditionLoading() {
  return <div aria-hidden="true" className="mt-8">
    <div className="mb-12 max-w-3xl space-y-5"><Skeleton className="h-11 w-3/4 rounded-xl" /><Skeleton className="h-5 w-full rounded-lg" /><Skeleton className="h-4 w-64 rounded-lg" /></div>
    <div className={withRail}><div className="space-y-3"><Skeleton className="h-4 w-full rounded-lg" /><Skeleton className="h-4 w-full rounded-lg" /><Skeleton className="h-4 w-4/5 rounded-lg" /></div><Skeleton className="h-80 rounded-2xl" /></div>
  </div>;
}
function EditionBody({edition: pending, cards, path}: {edition: Promise<DigestEdition | undefined>; cards: Promise<EditionCardsData>; path: string}) {
  const edition = use(pending);
  const locale = useLocale();
  if (!edition) notFound();
  const {intro, parts} = editionParts(edition.markdown);
  const listAnchor = edition.reviews ? "reviews" : "publications";
  return <>
    <header className="mb-12 mt-8 max-w-4xl">
      <h1 className="font-heading text-4xl font-semibold leading-[1.1] tracking-tight text-balance sm:text-5xl">{edition.title}</h1>
      <MarkdownExcerpt className={`mt-5 max-w-3xl text-lg leading-8 ${muted}`}>{edition.summary}</MarkdownExcerpt>
      <div className="mt-6"><EditionMeta edition={edition} /></div>
    </header>
    <div className={withRail}>
      <article className="min-w-0">
        <EditorNote edition={edition} />
        {intro && <AIMarkdown>{intro}</AIMarkdown>}
        <div className="space-y-12">{parts.map(part => <section key={part.id} id={part.id} aria-labelledby={`${part.id}-title`} className="scroll-mt-8">
          <SectionTitle className="mb-4"><span id={`${part.id}-title`}>{part.title}</span></SectionTitle>
          <AIMarkdown>{part.body}</AIMarkdown>
        </section>)}</div>
        <section id="publications" className="mt-16 scroll-mt-8" aria-labelledby="publications-title">
          <SectionTitle className="mb-2"><span id="publications-title">In this edition</span></SectionTitle>
          {edition.publicationCount > edition.listed && <p className={`mb-6 max-w-2xl text-sm leading-6 ${muted}`}>{edition.listed.toLocaleString(locale)} of {publicationCount(edition.publicationCount, locale)} from this period: meta-analyses and reviews first, then the publications with an abstract, ranked by the journal&apos;s standing, references, known institutions and citations.</p>}
          <EditionLists edition={edition} cards={cards} path={path} locale={locale} />
        </section>
      </article>
      <aside className="space-y-4 lg:sticky lg:top-8">
        <Contents parts={parts} edition={edition} listAnchor={listAnchor} locale={locale} />
        <EditionShare edition={edition} locale={locale} />
      </aside>
    </div>
  </>;
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
    }, {rootMargin: "-15% 0px -70% 0px"});
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
  const rows = [...parts.map(part => ({id: part.id, href: part.id, title: part.title, count: part.cited, label: `${part.cited} cited`})), {id: "publications", href: listAnchor, title: "In this edition", count: edition.listed, label: `${edition.listed} listed`}];
  if (!parts.length) return null;
  return <SidebarCard title="Contents">
    <ul className="-mx-3 -my-2 flex flex-col">{rows.map(row => <li key={row.id}>
      <a href={`#${row.href}`} aria-current={active === row.id ? "location" : undefined} className={twMerge(railRow, active === row.id && "bg-black/5 font-medium text-accent dark:bg-white/5")}>
        <span className="min-w-0 flex-1 leading-5">{row.title}</span>
        <span aria-label={row.label} className={`inline-flex shrink-0 items-center gap-1 text-xs tabular-nums ${muted}`}><Icon value={BookOpen01Icon} size={12} />{row.count.toLocaleString(locale)}</span>
      </a>
    </li>)}</ul>
  </SidebarCard>;
}
/** The period's publications as one bar: the meta-analyses and reviews listed, the other publications listed, and those not listed. */
function EditionShare({edition, locale}: {edition: DigestEdition; locale: string}) {
  const reviews = edition.reviews?.listed ?? 0;
  const rows = [
    ...(edition.reviews ? [{href: "#reviews", label: "Meta-analyses and reviews", count: reviews, tone: "bg-accent"}] : []),
    {href: edition.reviews ? "#other-publications" : "#publications", label: edition.reviews ? "Other publications" : "Listed", count: edition.listed - reviews, tone: "bg-accent/45"},
    {href: null, label: "Not listed", count: edition.publicationCount - edition.listed, tone: "bg-black/10 dark:bg-white/15"},
  ].filter(row => row.count > 0);
  return <SidebarCard title="Publications" band={<>
    <HeadFigure value={edition.publicationCount.toLocaleString(locale)} label="publications" />
    <div aria-hidden className="flex h-3 gap-[2px] overflow-hidden rounded-full">{rows.map(row => <span key={row.label} className={`h-full min-w-[3px] ${row.tone}`} style={{flexGrow: row.count, flexBasis: 0}} />)}</div>
  </>}>
    <ul className="-mx-3 -my-2 flex flex-col">{rows.map(row => {
      const content = <><span aria-hidden className={`size-2.5 shrink-0 rounded-[3px] ${row.tone}`} /><span className="min-w-0 flex-1">{row.label}</span><span className="text-sm font-semibold tabular-nums">{row.count.toLocaleString(locale)}</span></>;
      return <li key={row.label}>{row.href ? <a href={row.href} className={railRow}>{content}</a> : <div className={twMerge(railRow, "hover:bg-transparent dark:hover:bg-transparent")}>{content}</div>}</li>;
    })}</ul>
  </SidebarCard>;
}

/** The edition's publications: its meta-analyses and reviews first as a list of their own, then the others, each with its own pages. */
function EditionLists({edition, cards, path, locale}: {edition: DigestEdition; cards: Promise<EditionCardsData>; path: string; locale: string}) {
  const {reviews} = edition;
  const list = (anchor: string, keys: string[], page: number, pages: number, href: (next: number) => string) => <Paged page={page} pages={pages} href={href} anchor={anchor}>
    <Suspense fallback={<CardsLoading keys={keys} />}><EditionCards cards={cards} keys={keys} /></Suspense>
  </Paged>;
  if (!reviews) return list("publications", edition.keys, edition.page, edition.pages, next => address(path, next));
  return <>
    <ListHeading id="reviews" title="Meta-analyses and reviews" count={reviews.listed} locale={locale} />
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
function CardsLoading({keys}: {keys: string[]}) {
  return <div className={cardList}>{keys.map(key => <Resource key={key} as="div" abstract hideUnapi isLoading itemData={undefined} />)}</div>;
}
function EditionCards({cards: pending, keys}: {cards: Promise<EditionCardsData>; /** The cards of one list, in its order. */ keys: string[]}) {
  const {cards, profiles} = use(pending);
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
