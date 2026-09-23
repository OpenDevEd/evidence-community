"use client";

import { Suspense, use } from "react";
import { useLocale } from "next-intl";
import { notFound, useRouter } from "next/navigation";
import Link from "next/link";
import PageContainer from "@/components/layout/PageContainer";
import { Calendar03Icon, ArrowRight01Icon, BookOpen01Icon } from "@hugeicons/core-free-icons";
import type { DigestArchivePage, DigestEdition, DigestSummary } from "@/lib/notifications/public";
import { CoverImage } from "@/components/features/items/CoverImage";
import type { ListItem } from "@/app/api/item/types";
import { AuthorProfilesContext } from "@/lib/authors/use-author-profiles";
import type { AuthorProfile } from "@/lib/authors/profiles";
import { Pagination } from "@/components/nextui/Pagination";
import { describeDigestSchedule } from "@/lib/notifications/schedule";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { Skeleton } from "@/components/nextui/Skeleton";
import styles from "./DigestPages.module.css";
import Resource from "@/components/features/items/Resource";

import { AIMarkdown, MarkdownExcerpt } from "@/components/features/markdown/Markdown";


import { SectionTitle } from "@/components/typography/SectionTitle";
import { Icon, TextLink, muted } from "./DigestPrimitives";
import { Subscription, type Preferences } from "./Subscription";

function publicationCount(count: number, locale: string) {
  return `${count.toLocaleString(locale)} ${count === 1 ? "publication" : "publications"}`;
}
/** The page number lives in the URL, so every page can be shared and reloaded. */
function PageControls({page, pages, href}: {page: number; pages: number; href: (page: number) => string}) {
  const router = useRouter();
  if (pages < 2) return null;
  return <Pagination showControls page={page} total={pages} onChange={next => router.push(href(next), {scroll: false})} className="mt-6 flex justify-center" />;
}

function EditionMeta({ edition }: { edition: DigestSummary }) {
  const locale = useLocale();
  return <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-xs ${muted}`}><span className="inline-flex items-center gap-1.5"><Icon value={Calendar03Icon} size={14} /><time dateTime={edition.publishedAt}>{edition.date}</time></span><span className="inline-flex items-center gap-1.5"><Icon value={BookOpen01Icon} size={14} />{publicationCount(edition.publicationCount, locale)}</span></div>;
}
function DigestContent({ edition }: { edition: DigestEdition }) {
  return <AIMarkdown>{edition.markdown}</AIMarkdown>;
}
const newReader: Preferences = {email: "", digest: true, instant: false, confirmed: false};
type DigestSettings = {libraryName: string; enabled: boolean; timezone: string; schedule: string};
type Base = {settings: DigestSettings; base: string};
type ArchiveProps = {view: "archive"; latest: Promise<DigestSummary | null>; editions: Promise<DigestArchivePage>; nextEdition: Promise<string | null>};
export type EditionCardsData = {cards: ListItem[]; profiles: AuthorProfile[]};
type EditionProps = {view: "edition"; slug: string; earlier: Promise<DigestSummary[]>; edition: Promise<DigestEdition | undefined>; cards: Promise<EditionCardsData>};
type PreferencesProps = {view: "preferences"; token: Promise<string>; subscriber: Promise<Preferences | null>};

// The page structure comes from the library configuration the client already
// has. Only the parts that read digest rows wait, each behind its own
// placeholder. Links between digest pages prefetch the whole page, data
// included, so an edition opened from the list is already complete.
export default function DigestPages(props: ArchiveProps | EditionProps | PreferencesProps) {
  const locale = useLocale(); const base = `/${locale}/digests`;
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
          <Suspense fallback={<Skeleton className="mt-7 h-5 w-44 rounded-lg" />}><LatestEditionLink latest={latest} base={base} /></Suspense>
          {settings.enabled && <Suspense fallback={<Skeleton className="mt-5 h-5 w-80 max-w-full rounded-lg" />}><NextEdition nextEdition={nextEdition} settings={settings} locale={locale} /></Suspense>}
        </div>
        <Suspense fallback={<Skeleton className="mx-auto h-[337px] w-full max-w-md rounded-2xl" />}><FeaturedEdition latest={latest} settings={settings} base={base} locale={locale} /></Suspense>
      </header>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Latest editions</h2></div>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
        <section aria-label="Digest archive" className="space-y-3">
          <Suspense fallback={[0, 1, 2].map(index => <Skeleton key={index} className="h-40 rounded-2xl" />)}><ArchiveList editions={editions} settings={settings} base={base} locale={locale} /></Suspense>
        </section>
        {settings.enabled && <aside className="space-y-5 lg:sticky lg:top-12"><Subscription initial={newReader} schedule={settings.schedule} /></aside>}
      </div>
  </PageContainer>;
}
function LatestEditionLink({latest, base}: {latest: Promise<DigestSummary | null>; base: string}) {
  const edition = use(latest);
  if (!edition) return null;
  return <Link href={`${base}/${edition.slug}`} prefetch className="mt-7 inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-accent outline-offset-4 transition-colors hover:text-accent/80">Read the latest edition<Icon value={ArrowRight01Icon} size={18} /></Link>;
}
function NextEdition({nextEdition, settings, locale}: {nextEdition: Promise<string | null>; settings: DigestSettings; locale: string}) {
  const value = use(nextEdition);
  if (!value) return null;
  const next = new Date(value);
  const nextDate = next.toLocaleDateString(locale, {weekday: "long", day: "numeric", month: "long", timeZone: settings.timezone});
  const nextTime = next.toLocaleTimeString(locale, {hour: "2-digit", minute: "2-digit", hour12: false, timeZone: settings.timezone});
  return (
          <div className="mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm"><span className="text-accent"><Icon value={Calendar03Icon} size={16} /></span><span className={`text-xs ${muted}`}>Next edition</span><time dateTime={next.toISOString()} className="font-medium">{nextDate}</time><span className={`text-xs tabular-nums ${muted}`}>{nextTime} {settings.timezone}</span></div>);
}
function ArchiveList({editions, settings, base, locale}: {editions: Promise<DigestArchivePage>; settings: DigestSettings; base: string; locale: string}) {
  const {editions: items, page, pages} = use(editions);
  if (!items.length) return <p className={`py-5 text-sm ${muted}`}>No editions yet. The first digest will appear after new publications are added.</p>;
  return <>{items.map(item => {const date = new Date(item.publishedAt); const day = date.toLocaleDateString(locale, {day: "numeric", timeZone: settings.timezone}); const month = date.toLocaleDateString(locale, {month: "short", timeZone: settings.timezone});return <Link key={item.slug} href={`${base}/${item.slug}`} prefetch className="group grid grid-cols-[56px_minmax(0,1fr)_18px] items-start gap-4 rounded-2xl bg-card_light p-5 transition-colors hover:bg-black/[0.06] dark:bg-card dark:hover:bg-white/[0.055] sm:grid-cols-[64px_minmax(0,1fr)_18px] sm:gap-5">
            <time dateTime={item.publishedAt} aria-label={item.date} className="rounded-xl bg-black/[0.04] px-1 py-3 text-center dark:bg-white/[0.04]"><span className="block text-2xl font-semibold leading-none tabular-nums">{Number(day)}</span><span className={`mt-2 block text-xs ${muted}`}>{month}</span></time>
            <div><h2 className="text-xl font-semibold leading-snug transition-colors group-hover:text-accent">{item.title}</h2><MarkdownExcerpt className={`mt-2 text-sm leading-6 ${muted}`}>{item.summary}</MarkdownExcerpt><span className={`mt-3 inline-flex items-center gap-1.5 text-xs ${muted}`}><Icon value={BookOpen01Icon} size={14} />{publicationCount(item.publicationCount, locale)}</span></div><span className="mt-1 text-accent"><Icon value={ArrowRight01Icon} size={18} /></span>
          </Link>;})}
    <PageControls page={page} pages={pages} href={next => next > 1 ? `${base}?page=${next}` : base} /></>;
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
            {edition.publicationCount > edition.listed && <p className={`-mt-2 mb-4 text-sm ${muted}`}>The first {edition.listed.toLocaleString(locale)} of {publicationCount(edition.publicationCount, locale)} added in this period.</p>}
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
              <time dateTime={item.publishedAt} className={`text-xs ${muted}`}>{item.date}</time><h3 className="mt-1.5 text-sm font-semibold leading-5 group-hover:text-accent">{item.title}</h3>
            </Link>)}</div>;
}

function FeaturedEdition({latest, settings, base, locale}: {latest: Promise<DigestSummary | null>; settings: DigestSettings; base: string; locale: string}) {
  const edition = use(latest);
  if (!edition) return null;
  const {cover} = edition;
  const published = new Date(edition.publishedAt);
return (
        <Link href={`${base}/${edition.slug}`} prefetch aria-label={`Read ${edition.title}`} className={`${styles.cover} group relative isolate mx-auto block w-full max-w-md rounded-2xl outline-offset-8`}>
          <div aria-hidden="true" className={`${styles.backSheet} absolute inset-0 -z-10 rounded-2xl bg-[#a8623f]`} />
          <div aria-hidden="true" className={`${styles.middleSheet} absolute inset-0 -z-10 rounded-2xl bg-[#d7c7b2]`} />
          <article className={`${styles.frontSheet} relative flex min-h-[300px] flex-col overflow-hidden rounded-2xl bg-[#eee4d5] text-[#352b24] shadow-xl`}>
            <div className="flex items-center gap-4 px-7 pt-6"><span className="inline-flex items-center gap-2 text-xs font-medium text-[#352b24]/65"><Icon value={BookOpen01Icon} size={16} />{settings.libraryName}</span></div>
            <div className="relative flex flex-1 items-center gap-6 px-7 py-7">
              <div className="shrink-0 self-start pt-1" aria-hidden="true"><span className="block text-[76px] font-bold leading-[0.85] tracking-[-0.08em] text-[#ac5937]">{published.toLocaleDateString(locale, {day: "2-digit", timeZone: settings.timezone})}</span><span className="mt-3 block text-center text-xs font-medium text-[#352b24]/65">{published.toLocaleDateString(locale, {month: "long", year: "numeric", timeZone: settings.timezone})}</span></div>
              <h2 className={`relative text-[28px] font-semibold leading-[1.12] tracking-tight ${cover ? "max-w-[190px]" : "max-w-[230px]"}`}>{edition.title}</h2>
            </div>
            <MarkdownExcerpt className="-mt-2 mb-6 line-clamp-2 px-7 text-sm leading-6 text-[#352b24]/70">{edition.summary}</MarkdownExcerpt>
            <div className="relative flex items-center justify-between gap-4 bg-[#352b24] px-7 py-4 text-[#eee4d5]"><span className="text-xs text-[#eee4d5]/70">{publicationCount(edition.publicationCount, locale)}</span><span className="inline-flex items-center gap-2 text-sm font-medium">Read edition<Icon value={ArrowRight01Icon} size={18} /></span></div>
          </article>
          {/* One real cover from the edition, pinned over the corner like a clipped photo. */}
          {cover && <span aria-hidden="true" className="absolute -right-4 -top-5 h-36 w-[6.75rem] rotate-6 overflow-hidden rounded-md bg-white shadow-xl ring-1 ring-[#352b24]/15 transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:rotate-[9deg] motion-reduce:transition-none">
            <CoverImage src={cover} alt="" fill sizes="108px" className="object-cover object-top" />
          </span>}
        </Link>);
}
