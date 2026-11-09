"use client";

import { useFormatter, useTranslations } from "next-intl";
import { PaginationItemType } from "@nextui-org/pagination";
import { Pagination } from "@/components/nextui/Pagination";
import { Link, useRouter } from "@/i18n/routing";
import { twMerge } from "@/lib/tw-merge";

/**
 * The library's pager under a year's records, as the results list draws it, with each page a link: a person clicks
 * through as anywhere else, and a crawler can follow every page it shows.
 */
export function BrowsePager({ base, page, pages, total, perPage }: { base: string; page: number; pages: number; total: number; perPage: number }) {
  const t = useTranslations("ui");
  const format = useFormatter();
  const router = useRouter();
  const href = (number: number) => (number === 1 ? base : `${base}?page=${number}`);
  if (pages <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-small tabular-nums text-black/50 dark:text-white/50">
        {t("collectionsRange", { from: format.number((page - 1) * perPage + 1), to: format.number(Math.min(page * perPage, total)), total: format.number(total) })}
      </span>
      <Pagination
        total={pages}
        page={page}
        siblings={1}
        showControls
        // The moving highlight belongs to NextUI's own items; these are links, so the current one carries the highlight itself.
        disableCursorAnimation
        onChange={(number) => router.push(href(number))}
        renderItem={({ ref, key, value, isActive, onNext, onPrevious, className }) => {
          if (value === PaginationItemType.DOTS) return <span key={key} ref={ref} className={className}>…</span>;
          const target = value === PaginationItemType.NEXT ? page + 1 : value === PaginationItemType.PREV ? page - 1 : value;
          if (target < 1 || target > pages) return <span key={key} ref={ref} className={className} aria-disabled="true">{value === PaginationItemType.NEXT ? "›" : "‹"}</span>;
          return <Link key={key} ref={ref} href={href(target)} className={twMerge(className, isActive && "!border-transparent !bg-accent !text-white")} data-active={isActive || undefined} aria-current={isActive ? "page" : undefined} onClick={(event) => { if (value === PaginationItemType.NEXT) { event.preventDefault(); onNext(); } else if (value === PaginationItemType.PREV) { event.preventDefault(); onPrevious(); } }}>{value === PaginationItemType.NEXT ? "›" : value === PaginationItemType.PREV ? "‹" : value}</Link>;
        }}
      />
    </div>
  );
}
