"use client";

import Link from "next/link";
import { ArrowRight01Icon, BookOpen01Icon } from "@hugeicons/core-free-icons";
import type { DigestSummary } from "@/lib/notifications/public";
import { CoverImage } from "@/components/features/items/CoverImage";
import { MarkdownExcerpt } from "@/components/features/markdown/Markdown";
import styles from "./DigestPages.module.css";
import { Icon } from "./DigestPrimitives";

export function publicationCount(count: number, locale: string) {
  return `${count.toLocaleString(locale)} ${count === 1 ? "publication" : "publications"}`;
}

/** A digest edition as a stack of paper sheets: the digests page's latest edition, and the home page's digests. */
export function DigestCover({edition, libraryName, timezone, href, locale, titleAs: Title = "h2"}: {edition: DigestSummary; libraryName: string; timezone: string; href: string; locale: string; /** A heading on the digests page; inside a section elsewhere. */ titleAs?: "h2" | "h3"}) {
  const {cover} = edition;
  const published = new Date(edition.publishedAt);
  return (
        <Link href={href} prefetch aria-label={`Read ${edition.title}`} className={`${styles.cover} group relative isolate mx-auto block w-full max-w-md rounded-2xl outline-offset-8`}>
          <div aria-hidden="true" className={`${styles.backSheet} absolute inset-0 -z-10 rounded-2xl bg-[#a8623f]`} />
          <div aria-hidden="true" className={`${styles.middleSheet} absolute inset-0 -z-10 rounded-2xl bg-[#d7c7b2]`} />
          <article className={`${styles.frontSheet} relative flex min-h-[300px] flex-col overflow-hidden rounded-2xl bg-[#eee4d5] text-[#352b24] shadow-xl`}>
            <div className="flex items-center gap-4 px-7 pt-6"><span className="inline-flex items-center gap-2 text-xs font-medium text-[#352b24]/65"><Icon value={BookOpen01Icon} size={16} />{libraryName}</span></div>
            <div className="relative flex flex-1 items-center gap-6 px-7 py-7">
              <div className="shrink-0 self-start pt-1" aria-hidden="true"><span className="block text-[76px] font-bold leading-[0.85] tracking-[-0.08em] text-[#ac5937]">{published.toLocaleDateString(locale, {day: "2-digit", timeZone: timezone})}</span><span className="mt-3 block text-center text-xs font-medium text-[#352b24]/65">{published.toLocaleDateString(locale, {month: "long", year: "numeric", timeZone: timezone})}</span></div>
              <Title className={`relative text-[28px] font-semibold leading-[1.12] tracking-tight ${cover ? "max-w-[190px]" : "max-w-[230px]"}`}>{edition.title}</Title>
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
