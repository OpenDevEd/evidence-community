"use client";

import { Pagination } from "@/components/nextui/Pagination";

export function pageOf<T>(items: readonly T[], page: number, perPage: number) {
	const pages = Math.max(1, Math.ceil(items.length / perPage));
	const current = Math.min(page, pages);
	return { current, items: items.slice((current - 1) * perPage, current * perPage), pages };
}

/** The range shown and the page buttons; nothing when everything fits on one page. */
export function ImportPager({
	label,
	onChange,
	page,
	pages,
	perPage,
	total,
}: {
	label: string;
	onChange: (page: number) => void;
	page: number;
	pages: number;
	perPage: number;
	total: number;
}) {
	if (pages < 2) return null;
	const current = Math.min(page, pages);
	return (
		<div className="flex items-center gap-3 pt-3">
			<span className="text-xs tabular-nums text-black/50 dark:text-white/50">
				{(current - 1) * perPage + 1} to {Math.min(current * perPage, total)} of {total}
			</span>
			<Pagination aria-label={label} className="ms-auto" onChange={onChange} page={current} showControls siblings={0} size="sm" total={pages} />
		</div>
	);
}
