"use client";

import { useFormatter, useTranslations } from "next-intl";

import { Pagination } from "@/components/nextui/Pagination";

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
