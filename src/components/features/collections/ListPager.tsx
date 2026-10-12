"use client";

import { useFormatter, useTranslations } from "next-intl";

import { Pagination } from "@/components/nextui/Pagination";

/** Which page a list is on, and the rows it shows there. */
export function pageOf<T>(rows: T[], page: number, perPage: number) {
	const pages = Math.max(1, Math.ceil(rows.length / perPage));
	const current = Math.min(Math.max(page, 1), pages);
	return { pages, current, shown: rows.slice((current - 1) * perPage, current * perPage) };
}

/** The page a row is on, or the first page when the list doesn't hold it. */
export function pageWith<T>(rows: T[], matches: (row: T) => boolean, perPage: number) {
	const index = rows.findIndex(matches);
	return index < 0 ? 1 : Math.floor(index / perPage) + 1;
}

/** Under a paged list: which rows it shows of how many, then the pages. Nothing when it fits on one page. */
export function ListPager({ page, pages, total, perPage, onChange }: { page: number; pages: number; total: number; perPage: number; onChange: (page: number) => void }) {
	const t = useTranslations("ui");
	const format = useFormatter();
	if (pages <= 1) return null;
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-small tabular-nums text-black/50 dark:text-white/50">
				{t("collectionsRange", {
					from: format.number((page - 1) * perPage + 1),
					to: format.number(Math.min(page * perPage, total)),
					total: format.number(total),
				})}
			</span>
			<Pagination total={pages} page={page} onChange={onChange} siblings={0} size="sm" showControls />
		</div>
	);
}
