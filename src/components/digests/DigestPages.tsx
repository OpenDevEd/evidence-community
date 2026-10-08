"use client";

import { Suspense, use } from "react";
import { useLocale } from "next-intl";
import { notFound } from "next/navigation";
import { Link, useRouter } from "@/i18n/routing";
import PageContainer from "@/components/layout/PageContainer";
import { Calendar03Icon, ArrowRight01Icon, BookOpen01Icon, Notification03Icon } from "@hugeicons/core-free-icons";
import type { DigestArchivePage, DigestDate, DigestEdition, DigestSummary } from "@/lib/notifications/public";
import type { ListItem } from "@/app/api/item/types";
import { AuthorProfilesContext } from "@/lib/authors/use-author-profiles";
import type { AuthorProfile } from "@/lib/authors/profiles";
import { Pagination } from "@/components/nextui/Pagination";
import { describeDigestSchedule, timeZoneLabel } from "@/lib/notifications/schedule";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { Skeleton } from "@/components/nextui/Skeleton";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import styles from "./DigestPages.module.css";
import Resource from "@/components/features/items/Resource";

import { AIMarkdown, MarkdownExcerpt } from "@/components/features/markdown/Markdown";


import { SectionTitle } from "@/components/typography/SectionTitle";
import { Icon, TextLink, muted } from "./DigestPrimitives";
import { DigestCover, FirstEditionCover, coverHeight, publicationCount } from "./DigestCover";
import { Subscription, type Preferences } from "./Subscription";

/** The page number lives in the URL, so every page can be shared and reloaded. */
function PageControls({page, pages, href}: {page: number; pages: number; href: (page: number) => string}) {
  const router = useRouter();
  if (pages < 2) return null;
  return <Pagination showControls page={page} total={pages} onChange={next => router.push(href(next), {scroll: false})} className="mt-6 flex justify-center" />;
}

function EditionMeta({ edition }: { edition: DigestSummary }) {
  const locale = useLocale();
  return <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-xs ${muted}`}><span className="inline-flex items-center gap-1.5"><Icon value={Calendar03Icon} size={14} /><time dateTime={edition.published.at}>{edition.published.date}</time></span><span className="inline-flex items-center gap-1.5"><Icon value={BookOpen01Icon} size={14} />{publicationCount(edition.publicationCount, locale)}</span></div>;
}
function DigestContent({ edition }: { edition: DigestEdition }) {
  return <AIMarkdown>{edition.markdown}</AIMarkdown>;
}
const newReader: Preferences = {email: "", digest: true, instant: false, confirmed: false};
type DigestSettings = {libraryName: string; enabled: boolean; timezone: string; schedule: string};
type Base = {settings: DigestSettings; base: string};
type ArchiveProps = {view: "archive"; latest: Promise<DigestSummary | null>; editions: Promise<DigestArchivePage>; nextEdition: Promise<DigestDate | null>};
export type EditionCardsData = {cards: ListItem[]; profiles: AuthorProfile[]};
type EditionProps = {view: "edition"; slug: string; earlier: Promise<DigestSummary[]>; edition: Promise<DigestEdition | undefined>; cards: Promise<EditionCardsData>};
type PreferencesProps = {view: "preferences"; token: Promise<string>; subscriber: Promise<Preferences | null>};

// The page structure comes from the library configuration the client already
// has. Only the parts that read digest rows wait, each behind its own
// placeholder. Links between digest pages prefetch the whole page, data
// included, so an edition opened from the list is already complete.
export default function DigestPages(props: ArchiveProps | EditionProps | PreferencesProps) {
  const locale = useLocale(); const base = "/digests";
  const {identity, notifications} = useLibraryConfig();
  const settings = {libraryName: identity.name, enabled: notifications.enabled, timezone: notifications.schedule.timezone, schedule: describeDigestSchedule(notifications.schedule, locale)};
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

function DigestArchive({settings, latest, editions, nextEdition, base, locale}: ArchiveProps & Base & {locale: string}) {
  return <PageContainer className="mx-auto relative z-0 -mt-6 overflow-visible pt-0 lg:pt-0 xl:pt-0">
      <header className={`${styles.hero} relative isolate mb-8 grid items-center gap-8 px-0 pb-12 pt-16 lg:grid-cols-[1fr_0.9fr] lg:gap-14 lg:pb-16 lg:pt-20`}>
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-1/2 -top-[100vh] -z-10 w-screen -translate-x-1/2 bg-card_light dark:bg-card" />
        <div className="max-w-lg">
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">Library<br />digests</h1>
          <p className="mt-5 max-w-sm text-base leading-7 text-black/60 dark:text-white/60">Summaries of new publications in this library.</p>
          {settings.enabled && <Suspense fallback={<NextEditionLoading />}><NextEdition nextEdition={nextEdition} settings={settings} /></Suspense>}
        </div>
        <Suspense fallback={<Skeleton className={`mx-auto ${coverHeight} w-full max-w-md rounded-2xl`} />}><FeaturedEdition latest={latest} nextEdition={nextEdition} settings={settings} base={base} locale={locale} /></Suspense>
      </header>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Latest editions</h2></div>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
        <section aria-label="Digest archive" className="space-y-3">
          <Suspense fallback={[0, 1, 2].map(index => <Skeleton key={index} className="h-40 rounded-2xl" />)}><ArchiveList editions={editions} nextEdition={nextEdition} settings={settings} base={base} locale={locale} /></Suspense>
        </section>
        {settings.enabled && <aside className="space-y-5 lg:sticky lg:top-12"><Subscription initial={newReader} schedule={settings.schedule} /></aside>}
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
    <div className="w-0 flex-1"><p className={`truncate text-xs ${muted}`}>Next edition</p><p className="mt-1 truncate font-medium">{next.dayName} at {next.time}</p><TruncatedText text={timeZoneLabel(settings.timezone)} className={`mt-0.5 text-xs ${muted}`} /></div>
  </div>;
}
function ArchiveList({editions, nextEdition, settings, base, locale}: {editions: Promise<DigestArchivePage>; nextEdition: Promise<DigestDate | null>; settings: DigestSettings; base: string; locale: string}) {
  const {editions: items, page, pages} = use(editions);
  if (!items.length) return <EmptyArchive next={settings.enabled ? use(nextEdition) : null} settings={settings} />;
  return <>{items.map(item => <Link key={item.slug} href={`${base}/${item.slug}`} prefetch className="group grid grid-cols-[56px_minmax(0,1fr)_18px] items-start gap-4 rounded-2xl bg-card_light p-5 transition-colors hover:bg-black/[0.06] dark:bg-card dark:hover:bg-white/[0.055] sm:grid-cols-[64px_minmax(0,1fr)_18px] sm:gap-5">
            <time dateTime={item.published.at} aria-label={item.published.date} className="rounded-xl bg-black/[0.04] px-1 py-3 text-center dark:bg-white/[0.04]"><span className="block text-2xl font-semibold leading-none tabular-nums">{Number(item.published.day)}</span><span className={`mt-2 block text-xs ${muted}`}>{item.published.month}</span></time>
            <div><h2 className="text-xl font-semibold leading-snug transition-colors group-hover:text-accent">{item.title}</h2><MarkdownExcerpt className={`mt-2 text-sm leading-6 ${muted}`}>{item.summary}</MarkdownExcerpt><span className={`mt-3 inline-flex items-center gap-1.5 text-xs ${muted}`}><Icon value={BookOpen01Icon} size={14} />{publicationCount(item.publicationCount, locale)}</span></div><span className="mt-1 text-accent"><Icon value={ArrowRight01Icon} size={18} /></span>
          </Link>)}
    <PageControls page={page} pages={pages} href={next => next > 1 ? `${base}?page=${next}` : base} /></>;
}

/** Before the first edition: the first row is kept for it, dated when it is scheduled, and the rows after it wait faintly below. */
function EmptyArchive({next, settings}: {next: DigestDate | null; settings: DigestSettings}) {
  // A library that sends no digests is not promised an edition.
  const [title, text] = settings.enabled
    ? ["Editions will collect here", `Each digest sums up the publications added since the one before. ${firstEdition(next)}`]
    : ["No editions yet", "This library is not sending digests at the moment."];
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
 return <PageContainer className="mx-auto ">

      <TextLink href={base} back>All digests</TextLink>
      <div className="mt-8 grid items-start gap-8 lg:grid-cols-12">
        <article className="min-w-0 lg:col-span-8 xl:col-span-9">
          <Suspense fallback={<EditionLoading />}><EditionBody edition={edition} cards={cards} href={next => next > 1 ? `${base}/${slug}?page=${next}` : `${base}/${slug}`} /></Suspense>
        </article>
        <aside className="space-y-8 lg:col-span-4 xl:col-span-3">
          <section aria-label="Past digests">
            <SectionTitle className="mb-4 flex items-center gap-2"><span className="text-accent"><Icon value={Calendar03Icon} /></span>Past digests</SectionTitle>
            <Suspense fallback={<div className="space-y-2">{[0, 1].map(index => <Skeleton key={index} className="h-[4.5rem] rounded-xl" />)}</div>}><PastDigests earlier={earlier} base={base} /></Suspense>
            <div className="mt-4"><TextLink href={base}>Browse all digests</TextLink></div>
          </section>
          {settings.enabled && <Subscription initial={newReader} schedule={settings.schedule} />}
        </aside>
      </div>
 </PageContainer>;
}
function EditionLoading() {
  return <div aria-hidden="true">
    <div className="mb-9 space-y-5"><Skeleton className="h-9 w-3/4 rounded-xl" /><Skeleton className="h-4 w-56 rounded-lg" /></div>
    <div className="space-y-3"><Skeleton className="h-4 w-full rounded-lg" /><Skeleton className="h-4 w-full rounded-lg" /><Skeleton className="h-4 w-4/5 rounded-lg" /></div>
  </div>;
}
function EditionBody({edition: pending, cards, href}: {edition: Promise<DigestEdition | undefined>; cards: Promise<EditionCardsData>; href: (page: number) => string}) {
  const edition = use(pending);
  const locale = useLocale();
  if (!edition) notFound();
  return <>
          <header className="mb-9"><h1 className="text-3xl font-medium leading-tight">{edition.title}</h1><div className="mt-5"><EditionMeta edition={edition} /></div></header>
          <DigestContent edition={edition} />
          <section className="mt-10" aria-label="Referenced publications">
            <SectionTitle className="mb-4 flex items-center gap-2"><span className="text-accent"><Icon value={BookOpen01Icon} /></span>In this edition<span className={`ml-auto text-xs font-normal ${muted}`}>{edition.publicationCount.toLocaleString(locale)}</span></SectionTitle>
            {edition.publicationCount > edition.listed && <p className={`-mt-2 mb-4 text-sm ${muted}`}>{edition.listed.toLocaleString(locale)} of {publicationCount(edition.publicationCount, locale)} from this period.</p>}
            <Suspense fallback={<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{edition.keys.map(key => <Resource key={key} as="div" abstract={false} hideUnapi isLoading itemData={undefined} />)}</div>}><EditionCards cards={cards} /></Suspense>
            <PageControls page={edition.page} pages={edition.pages} href={href} />
          </section>
  </>;
}
function EditionCards({cards: pending}: {cards: Promise<EditionCardsData>}) {
  const {cards, profiles} = use(pending);
  // The server read the authors with the cards, so no card looks them up on its own.
  return <AuthorProfilesContext value={new Map(profiles.map(profile => [profile.id, profile]))}>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{cards.map(card => <Resource key={card.key} as="div" abstract={false} hideUnapi itemData={card} />)}</div>
  </AuthorProfilesContext>;
}
function PastDigests({earlier, base}: {earlier: Promise<DigestSummary[]>; base: string}) {
  const older = use(earlier);
  if (!older.length) return <p className={`text-sm ${muted}`}>This is the first edition.</p>;
  return <div className="space-y-2">{older.map(item => <Link key={item.slug} href={`${base}/${item.slug}`} prefetch className="group block rounded-xl bg-card_light p-4 transition-colors hover:bg-black/[0.06] dark:bg-card dark:hover:bg-white/[0.055]">
              <time dateTime={item.published.at} className={`text-xs ${muted}`}>{item.published.date}</time><h3 className="mt-1.5 text-sm font-semibold leading-5 group-hover:text-accent">{item.title}</h3>
            </Link>)}</div>;
}

function FeaturedEdition({latest, nextEdition, settings, base, locale}: {latest: Promise<DigestSummary | null>; nextEdition: Promise<DigestDate | null>; settings: DigestSettings; base: string; locale: string}) {
  const edition = use(latest);
  const next = use(nextEdition);
  return edition
    ? <DigestCover edition={edition} libraryName={settings.libraryName} href={`${base}/${edition.slug}`} locale={locale} />
    : <FirstEditionCover libraryName={settings.libraryName} sending={settings.enabled} next={settings.enabled ? next : null} />;
}
