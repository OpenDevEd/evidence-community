"use client";

import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import type { AdminImportCommitResult } from "@/lib/admin/item-import-contract";

import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import type { ImportRow } from "./admin-import";
import type { AttachState } from "./ImportReview";

const PER_PAGE = 8;

/** The import's outcome: the counts that matter, then each new draft to open. */
export function ImportDone({
	attach,
	onOpenRecord,
	results,
	rows,
}: {
	attach: ReadonlyMap<string, AttachState>;
	onOpenRecord: (itemKey: string) => void;
	results: AdminImportCommitResult[];
	rows: ImportRow[];
}) {
	const [page, setPage] = useState(1);
	const rowById = new Map(rows.map((row) => [row.id, row]));
	const created = results.filter(({ itemKey, outcome }) => outcome === "created" && itemKey);
	const pdfs = [...attach.values()];
	const count = (state: AttachState) => pdfs.filter((value) => value === state).length;
	const tally = [
		{ count: count("attached"), label: "PDFs attached", tone: "" },
		{ count: count("attaching"), label: "PDFs attaching", tone: "" },
		{ count: count("failed"), label: "PDFs not attached", tone: "text-amber-700 dark:text-amber-400" },
		{ count: results.filter(({ outcome }) => outcome === "skipped").length, label: "Already in the library", tone: "" },
		{ count: results.filter(({ outcome }) => outcome === "failed").length, label: "Not imported", tone: "text-danger" },
	].filter((line) => line.count > 0);
	const { current, items, pages } = pageOf(created, page, PER_PAGE);
	return (
		<div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-6">
			<div className="flex items-center gap-3">
				<HugeiconsIcon aria-hidden className="animate-rise-in text-emerald-600 dark:text-emerald-400" icon={CheckmarkCircle02Icon} size={28} />
				<div>
					<h3 className="text-base font-semibold text-black/90 dark:text-white/90">
						{created.length} {created.length === 1 ? "draft" : "drafts"} created
					</h3>
					<p className="text-xs text-black/50 dark:text-white/50">They stay in Drafts until someone publishes them.</p>
				</div>
			</div>
			{tally.length ? (
				<dl className="divide-y divide-black/[0.06] border-y border-black/[0.06] dark:divide-white/[0.06] dark:border-white/[0.06]">
					{tally.map((line) => (
						<div className="flex h-9 items-center text-sm" key={line.label}>
							<dt className="text-black/60 dark:text-white/60">{line.label}</dt>
							<dd className={`ms-auto font-medium tabular-nums text-black/85 dark:text-white/85 ${line.tone}`}>{line.count}</dd>
						</div>
					))}
				</dl>
			) : null}
			<div>
				<ul className="flex flex-col">
					{items.map(({ id, itemKey }) => {
						const row = rowById.get(id);
						return (
							<li className="flex h-12 items-center gap-3 rounded-lg px-2 hover:bg-black/[0.025] dark:hover:bg-white/[0.03]" key={id}>
								<ImportCover className="w-7" file={row?.file ?? null} itemType={row?.record?.itemType} size={12} />
								<span className="min-w-0 flex-1 truncate text-sm text-black/85 dark:text-white/85">{row?.record?.title ?? row?.record?.source}</span>
								<Button onPress={() => onOpenRecord(itemKey!)} size="xs" variant="transparent">
									Open
								</Button>
							</li>
						);
					})}
				</ul>
				<ImportPager label="Pages of new drafts" onChange={setPage} page={current} pages={pages} perPage={PER_PAGE} total={created.length} />
			</div>
		</div>
	);
}
