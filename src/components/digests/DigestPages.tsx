"use client";

import { useLocale } from "next-intl";
import Link from "next/link";
import PageContainer from "@/components/layout/PageContainer";
import { Calendar03Icon, ArrowRight01Icon, BookOpen01Icon } from "@hugeicons/core-free-icons";
import type { DigestEdition, DigestSummary, DigestPageData } from "@/lib/notifications/public";
type Edition = DigestEdition;
import styles from "./DigestPages.module.css";
import Resource from "@/components/features/items/Resource";

import { AIMarkdown, MarkdownExcerpt } from "@/components/features/markdown/Markdown";


import { SectionTitle } from "@/components/typography/SectionTitle";
import { Icon, TextLink, muted } from "./DigestPrimitives";
import { Subscription, type Preferences } from "./Subscription";

function EditionMeta({ edition }: { edition: DigestSummary }) {
  return <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-xs ${muted}`}><span className="inline-flex items-center gap-1.5"><Icon value={Calendar03Icon} size={14} /><time dateTime={edition.publishedAt}>{edition.date}</time></span><span className="inline-flex items-center gap-1.5"><Icon value={BookOpen01Icon} size={14} />{edition.publicationCount} {edition.publicationCount === 1 ? "publication" : "publications"}</span></div>;
}
function DigestContent({ edition }: { edition: Edition }) {
  return <AIMarkdown>{edition.markdown}</AIMarkdown>;
}
type ViewProps = {data: DigestPageData; initial: Preferences; base: string; locale: string};
export default function DigestPages({ data, view = "archive", initial = {email: "", digest: true, instant: false, confirmed: false}, token }: { data: DigestPageData; view?: string; initial?: Preferences; token?: string }) {
  const locale = useLocale(); const base = `/${locale}/digests`;
  if (view === "preferences") return <PageContainer className="mx-auto max-w-3xl"><TextLink href={base} back>Digests</TextLink><header className="mb-8 mt-7"><h1 className="text-3xl font-bold">Email preferences</h1><p className={`mt-3 text-sm ${muted}`}>Change your subscriptions to this library.</p></header><Subscription key="preferences" initial={initial} preferences token={token} schedule={data.schedule} /></PageContainer>;
  if (view === "archive") return <DigestArchive data={data} initial={initial} base={base} locale={locale} />;
  return <DigestDetail data={data} initial={initial} base={base} />;
}

function DigestArchive({data, initial, base, locale}: ViewProps) {
  const editions = data.editions;
  return <PageContainer className="mx-auto relative z-0 -mt-6 overflow-visible pt-0 lg:pt-0 xl:pt-0">
    <DigestHero data={data} base={base} locale={locale} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Latest editions</h2></div>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
        <ArchiveList editions={editions} data={data} base={base} locale={locale} />
        {data.enabled && <aside className="space-y-5 lg:sticky lg:top-28"><Subscription initial={initial} schedule={data.schedule} /></aside>}
      </div>
  </PageContainer>;
}
function DigestHero({data, base, locale}: Omit<ViewProps, "initial">) {
  const edition = data.editions[0];
  return (
      <header className={`${styles.hero} relative isolate mb-8 grid items-center gap-8 px-0 pb-12 pt-16 lg:grid-cols-[1fr_0.9fr] lg:gap-14 lg:pb-16 lg:pt-20`}>
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-1/2 -top-[100vh] -z-10 w-screen -translate-x-1/2 bg-card_light dark:bg-card" />
        <div className="max-w-lg">
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">Library<br />digests</h1>
          <p className="mt-5 max-w-sm text-base leading-7 text-black/60 dark:text-white/60">Summaries of new publications in this library.</p>
          {edition && <Link href={`${base}/${edition.slug}`} className="mt-7 inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-accent outline-offset-4 transition-colors hover:text-accent/80">Read the latest edition<Icon value={ArrowRight01Icon} size={18} /></Link>}

          <NextEdition data={data} locale={locale} />
        </div>
        {edition && <FeaturedEdition edition={edition} data={data} base={base} locale={locale} />}
      </header>
  );
}
function NextEdition({data, locale}: Pick<ViewProps, "data" | "locale">) {
  if (!data.nextEdition) return null;
  const next = new Date(data.nextEdition);
  const nextDate = next.toLocaleDateString(locale, {weekday: "long", day: "numeric", month: "long", timeZone: data.timezone});
  const nextTime = next.toLocaleTimeString(locale, {hour: "2-digit", minute: "2-digit", hour12: false, timeZone: data.timezone});
  return (
          <div className="mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm"><span className="text-accent"><Icon value={Calendar03Icon} size={16} /></span><span className={`text-xs ${muted}`}>Next edition</span><time dateTime={next.toISOString()} className="font-medium">{nextDate}</time><span className={`text-xs tabular-nums ${muted}`}>{nextTime} {data.timezone}</span></div>);
}
function ArchiveList({editions, data, base, locale}: Omit<ViewProps, "initial"> & {editions: DigestSummary[]}) {
 return (
        <section aria-label="Digest archive" className="space-y-3">{!editions.length && <p className={`py-5 text-sm ${muted}`}>No editions yet. The first digest will appear after new publications are added.</p>}
          {editions.map(item => {const date = new Date(item.publishedAt); const day = date.toLocaleDateString(locale, {day: "numeric", timeZone: data.timezone}); const month = date.toLocaleDateString(locale, {month: "short", timeZone: data.timezone});return <Link key={item.slug} href={`${base}/${item.slug}`} className="group grid grid-cols-[56px_minmax(0,1fr)_18px] items-start gap-4 rounded-2xl bg-card_light p-5 transition-colors hover:bg-black/[0.06] dark:bg-card dark:hover:bg-white/[0.055] sm:grid-cols-[64px_minmax(0,1fr)_18px] sm:gap-5">
            <time dateTime={item.publishedAt} aria-label={item.date} className="rounded-xl bg-black/[0.04] px-1 py-3 text-center dark:bg-white/[0.04]"><span className="block text-2xl font-semibold leading-none tabular-nums">{Number(day)}</span><span className={`mt-2 block text-xs ${muted}`}>{month}</span></time>
            <div><h2 className="text-xl font-semibold leading-snug transition-colors group-hover:text-accent">{item.title}</h2><MarkdownExcerpt className={`mt-2 text-sm leading-6 ${muted}`}>{item.summary}</MarkdownExcerpt><span className={`mt-3 inline-flex items-center gap-1.5 text-xs ${muted}`}><Icon value={BookOpen01Icon} size={14} />{item.publicationCount} {item.publicationCount === 1 ? "publication" : "publications"}</span></div><span className="mt-1 text-accent"><Icon value={ArrowRight01Icon} size={18} /></span>
          </Link>;})}
        </section>);
}
function DigestDetail({data, initial, base}: Omit<ViewProps, "locale">) {
 const edition = data.edition;
 const editions = data.editions;
 if (!edition) return null;
 return <PageContainer className="mx-auto ">

      <TextLink href={base} back>All digests</TextLink>
      <div className="mt-8 grid items-start gap-8 lg:grid-cols-12">
        <article className="min-w-0 lg:col-span-8 xl:col-span-9">
          <header className="mb-9"><h1 className="text-3xl font-medium leading-tight">{edition.title}</h1><div className="mt-5"><EditionMeta edition={edition} /></div></header>
          <DigestContent edition={edition} />
          <section className="mt-10" aria-label="Referenced publications">
            <SectionTitle className="mb-4 flex items-center gap-2"><span className="text-accent"><Icon value={BookOpen01Icon} /></span>In this edition<span className={`ml-auto text-xs font-normal ${muted}`}>{edition.publicationCount}</span></SectionTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{edition.publications.map(work => <Resource key={work.key} as="div" abstract={false} hideUnapi itemKey={work.key} />)}</div>
          </section>
        </article>
        <aside className="space-y-8 lg:col-span-4 xl:col-span-3">

          <PastDigests editions={editions} edition={edition} base={base} />
          {data.enabled && <Subscription initial={initial} schedule={data.schedule} />}
        </aside>
      </div>
 </PageContainer>;
}
function PastDigests({editions, edition, base}: {editions: DigestSummary[]; edition: DigestSummary; base: string}) {
 return (
          <section aria-label="Past digests">
            <SectionTitle className="mb-4 flex items-center gap-2"><span className="text-accent"><Icon value={Calendar03Icon} /></span>Past digests</SectionTitle>
            <div className="space-y-2">{editions.filter(item => item.publishedAt < edition.publishedAt).map(item => <Link key={item.slug} href={`${base}/${item.slug}`} className="group block rounded-xl bg-card_light p-4 transition-colors hover:bg-black/[0.06] dark:bg-card dark:hover:bg-white/[0.055]">
              <time dateTime={item.publishedAt} className={`text-xs ${muted}`}>{item.date}</time><h3 className="mt-1.5 text-sm font-semibold leading-5 group-hover:text-accent">{item.title}</h3>
            </Link>)}</div>
            {editions.every(item => item.publishedAt >= edition.publishedAt) && <p className={`text-sm ${muted}`}>This is the first edition.</p>}
            <div className="mt-4"><TextLink href={base}>Browse all digests</TextLink></div>
          </section>);
}

function FeaturedEdition({edition, data, base, locale}: Omit<ViewProps, "initial"> & {edition: DigestSummary}) {
return (
        <Link href={`${base}/${edition.slug}`} aria-label={`Read ${edition.title}`} className={`${styles.cover} group relative isolate mx-auto block w-full max-w-md rounded-2xl outline-offset-8`}>
          <div aria-hidden="true" className={`${styles.backSheet} absolute inset-0 -z-10 rounded-2xl bg-[#a8623f]`} />
          <div aria-hidden="true" className={`${styles.middleSheet} absolute inset-0 -z-10 rounded-2xl bg-[#d7c7b2]`} />
          <article className={`${styles.frontSheet} relative flex min-h-[300px] flex-col overflow-hidden rounded-2xl bg-[#eee4d5] text-[#352b24] shadow-xl`}>
            <div className="flex items-center justify-between gap-4 px-7 pt-6"><span className="inline-flex items-center gap-2 text-xs font-medium text-[#352b24]/65"><Icon value={BookOpen01Icon} size={16} />{data.libraryName}</span><span className="text-xs text-[#352b24]/60">{new Date(edition.publishedAt).getFullYear()}</span></div>
            <div className="relative flex flex-1 items-center gap-6 px-7 py-7">
              <div className="shrink-0 self-start pt-1" aria-hidden="true"><span className="block text-[76px] font-bold leading-[0.85] tracking-[-0.08em] text-[#ac5937]">{new Date(edition.publishedAt).toLocaleDateString(locale, {day: "2-digit", timeZone: data.timezone})}</span><span className="mt-3 block text-center text-xs font-medium text-[#352b24]/65">{new Date(edition.publishedAt).toLocaleDateString(locale, {month: "long", timeZone: data.timezone})}</span></div>
              <h2 className="relative max-w-[230px] text-[28px] font-semibold leading-[1.12] tracking-tight">{edition.title}</h2>
            </div>
            <div aria-hidden="true" className="relative mx-7 h-10 overflow-hidden">
              <span className="absolute -bottom-12 left-0 h-24 w-24 rounded-full border-[14px] border-[#ac5937]/70" />
              <span className="absolute -bottom-12 left-16 h-24 w-24 rounded-full border-[14px] border-[#ac5937]/40" />
              <span className="absolute -bottom-12 left-32 h-24 w-24 rounded-full border-[14px] border-[#ac5937]/20" />
              <span className="absolute -bottom-12 left-48 h-24 w-24 rounded-full border-[14px] border-[#ac5937]/10" />
            </div>
            <div className="relative flex items-center justify-between gap-4 bg-[#352b24] px-7 py-4 text-[#eee4d5]"><span className="text-xs text-[#eee4d5]/70">{edition.publicationCount} {edition.publicationCount === 1 ? "publication" : "publications"}</span><span className="inline-flex items-center gap-2 text-sm font-medium">Read edition<Icon value={ArrowRight01Icon} size={18} /></span></div>
          </article>
        </Link>);
}
