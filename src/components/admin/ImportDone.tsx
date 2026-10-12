"use client";

import { AlertCircleIcon, ArrowRight01Icon, Copy01Icon, Pdf01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";
import type { AdminImportCommitResult } from "@/lib/admin/item-import-contract";

import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import type { ImportRow } from "./admin-import";
import type { AttachState } from "./ImportReview";

const PER_PAGE = 6;

function Tally({ icon, label, tone }: { icon: typeof Tick02Icon; label: string; tone: string }) {
	return (
		<span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium tabular-nums ${tone}`}>
			<HugeiconsIcon aria-hidden icon={icon} size={13} />
			{label}
		</span>
	);
}

/** The import's outcome: what became a draft, what was skipped, and each new draft to open. */
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
	const failed = results.filter(({ outcome }) => outcome === "failed").length;
	const skipped = results.filter(({ outcome }) => outcome === "skipped").length;
	const pdfs = [...attach.values()];
	const attached = pdfs.filter((state) => state === "attached").length;
	const attaching = pdfs.filter((state) => state === "attaching").length;
	const notAttached = pdfs.filter((state) => state === "failed").length;
	const { current, items, pages } = pageOf(created, page, PER_PAGE);
	return (
		<div className="flex flex-col gap-7">
			<div className="flex flex-col items-center gap-3 pt-4 text-center">
				<span className="flex size-16 animate-rise-in items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_14px_30px_-14px_rgba(16,185,129,0.9)]">
					<HugeiconsIcon aria-hidden icon={Tick02Icon} size={30} strokeWidth={2.4} />
				</span>
				<h3 className="text-2xl font-semibold tracking-tight text-black/90 dark:text-white/90">
					{created.length} {created.length === 1 ? "draft" : "drafts"} created
				</h3>
				<div className="flex flex-wrap justify-center gap-2">
					{attached || attaching ? (
						<Tally
							icon={Pdf01Icon}
							label={attaching ? `Attaching ${attaching} ${attaching === 1 ? "PDF" : "PDFs"}` : `${attached} ${attached === 1 ? "PDF" : "PDFs"} attached`}
							tone="bg-black/[0.045] text-black/65 dark:bg-white/[0.07] dark:text-white/65"
						/>
					) : null}
					{notAttached ? <Tally icon={AlertCircleIcon} label={`${notAttached} ${notAttached === 1 ? "PDF" : "PDFs"} not attached`} tone="bg-amber-500/10 text-amber-700 dark:text-amber-400" /> : null}
					{skipped ? <Tally icon={Copy01Icon} label={`${skipped} already in the library`} tone="bg-black/[0.045] text-black/65 dark:bg-white/[0.07] dark:text-white/65" /> : null}
					{failed ? <Tally icon={AlertCircleIcon} label={`${failed} not imported`} tone="bg-danger/10 text-danger" /> : null}
				</div>
			</div>
			<div>
				<ul className="grid gap-2 sm:grid-cols-2">
					{items.map(({ id, itemKey }) => {
						const row = rowById.get(id);
						return (
							<li className="flex h-20 items-center gap-3 rounded-xl bg-white px-3 shadow-card-hairline ring-1 ring-black/[0.06] dark:bg-white/[0.04] dark:ring-white/10" key={id}>
								<ImportCover className="w-10" file={row?.file ?? null} itemType={row?.record?.itemType} size={14} />
								<span className="min-w-0 flex-1">
									<span className="line-clamp-2 text-[13px] font-medium leading-5 text-black/85 dark:text-white/85">{row?.record?.title ?? row?.record?.source}</span>
								</span>
								<Tooltip content="Open the draft">
									<Button aria-label={`Open ${row?.record?.title ?? "the draft"}`} className="size-8 min-w-8" isIconOnly onPress={() => onOpenRecord(itemKey!)} size="xs" variant="muted">
										<HugeiconsIcon aria-hidden icon={ArrowRight01Icon} size={15} />
									</Button>
								</Tooltip>
							</li>
						);
					})}
				</ul>
				<ImportPager label="Pages of new drafts" onChange={setPage} page={current} pages={pages} perPage={PER_PAGE} total={created.length} />
			</div>
		</div>
	);
}
