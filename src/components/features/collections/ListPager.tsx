"use client";

import type { ComponentProps } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { Pagination } from "@/components/nextui/Pagination";
import { Link } from "@/i18n/routing";
import { twMerge } from "@/lib/tw-merge";

type Pager = { page: number; pages: number; total: number; perPage: number };
type ItemProps = Parameters<NonNullable<ComponentProps<typeof Pagination>["renderItem"]>>[0];

/**
 * Under a paged list: which rows it shows of how many, then the pages. Nothing when it fits on one page. With `href`,
 * each page is a link to its own address, so a crawler can follow every page a person can click.
 */
export function ListPager({ page, pages, total, perPage, onChange, href }: Pager & ({ onChange: (page: number) => void; href?: never } | { href: (page: number) => string; onChange?: never })) {
	const t = useTranslations("ui");
	const format = useFormatter();
	if (pages <= 1) return null;
	return (
		<div className={twMerge("flex items-center justify-between gap-3", href && "flex-wrap")}>
			<span className="text-small tabular-nums text-black/50 dark:text-white/50">
				{t("collectionsRange", {
					from: format.number((page - 1) * perPage + 1),
					to: format.number(Math.min(page * perPage, total)),
					total: format.number(total),
				})}
			</span>
			{href ? (
				// The moving highlight belongs to NextUI's own items; these are links, so the current one carries the highlight itself.
				<Pagination total={pages} page={page} siblings={1} showControls disableCursorAnimation renderItem={(item) => <PageLink key={item.key} item={item} page={page} pages={pages} href={href} label={item.value === "prev" ? t("previous") : item.value === "next" ? t("next") : undefined} />} />
			) : (
				<Pagination total={pages} page={page} onChange={onChange} siblings={0} size="sm" showControls />
			)}
		</div>
	);
}

const ARROWS: Record<string, string> = { prev: "‹", next: "›", dots: "…" };

/** The page an item of the pager leads to; null for the dots and for an arrow at either end. */
function pageTarget(value: ItemProps["value"], page: number, pages: number) {
	const target = value === "next" ? page + 1 : value === "prev" ? page - 1 : value;
	return typeof target === "number" && target >= 1 && target <= pages ? target : null;
}

function PageLink({ item: { ref, value, isActive, className }, page, pages, href, label }: { item: ItemProps; page: number; pages: number; href: (page: number) => string; label: string | undefined }) {
	const target = pageTarget(value, page, pages);
	if (target === null) return <span ref={ref} className={className} aria-disabled={value !== "dots"} aria-label={label}>{ARROWS[value]}</span>;
	return (
		<Link ref={ref} href={href(target)} className={twMerge(className, isActive && "!border-transparent !bg-accent !text-white")} aria-current={isActive ? "page" : undefined} aria-label={label}>
			{ARROWS[value] ?? value}
		</Link>
	);
}
