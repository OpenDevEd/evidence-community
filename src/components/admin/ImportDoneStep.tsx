"use client";

import { AlertCircleIcon, Attachment01Icon, CheckmarkCircle02Icon, Copy01Icon, Link01Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";

import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";

import { DraftState, publishView } from "./ImportDone";
import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import { ListHeader, SettingsGroup, SummaryRow } from "./import-parts";
import type { ImportFlowState } from "./import-flow";

const ROWS_PER_PAGE = 8;

const TALLY_ICONS: Record<string, typeof Link01Icon> = {
	"Already in the library": Copy01Icon,
	"Not imported": AlertCircleIcon,
	"PDFs attached": Attachment01Icon,
	"PDFs attaching": Loading03Icon,
	"PDFs not attached": AlertCircleIcon,
};

/**
 * The finish step, built like the Add step: what the import did as a group
 * of rows at the top, then the new drafts as a list, ticked for publishing
 * with a DOI when every check passes.
 */
export function ImportDoneStep({ flow }: { flow: ImportFlowState }) {
	const [page, setPage] = useState(1);
	const view = publishView(flow.batch!, flow.choosePublish);
	const { current, items, pages } = pageOf(view.drafts, page, ROWS_PER_PAGE);
	const publishing = view.publishable.length > 0;
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5 pt-5 [scrollbar-gutter:stable]">
			<SettingsGroup>
				<SummaryRow icon={CheckmarkCircle02Icon} title="Drafts created" tone="text-emerald-700 dark:text-emerald-400" value={view.drafts.length} />
				{view.published ? <SummaryRow icon={Link01Icon} title="Published with a DOI" value={view.published} /> : null}
				{view.tally.map((line) => (
					<SummaryRow icon={TALLY_ICONS[line.label] ?? AlertCircleIcon} key={line.label} title={line.label} tone={line.tone} value={line.count} />
				))}
			</SettingsGroup>
			<div className="flex flex-col gap-2">
				<ListHeader
					aside={publishing && !view.started ? `${view.passing} pass every check` : undefined}
					lead={publishing ? <Checkbox aria-label="Choose every draft to publish" isDisabled={view.started} isIndeterminate={view.chosen.size > 0 && !view.all} isSelected={view.all} onValueChange={view.toggleAll} size="sm" /> : undefined}
					title={publishing ? (view.started ? `${view.published} of ${view.chosen.size} published` : `${view.chosen.size} of ${view.publishable.length} to publish`) : `${view.drafts.length} ${view.drafts.length === 1 ? "draft" : "drafts"}`}
				/>
				<ul className="flex flex-col">
					{items.map(({ itemKey, row }) => (
						<li className="flex min-h-16 items-center gap-3 rounded-lg pe-1 ps-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]" key={row.id}>
							{publishing ? <Checkbox aria-label={`Publish ${row.record?.title ?? row.record?.source}`} isDisabled={view.started || !row.file} isSelected={view.chosen.has(row.id)} onValueChange={(checked) => view.toggle(row.id, checked)} size="sm" /> : null}
							<ImportCover className="w-8" file={row.file} itemType={row.record?.itemType} size={12} />
							<span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
								<span className="line-clamp-2 text-sm font-medium leading-5 text-black/85 dark:text-white/85">{row.record?.title ?? row.record?.source}</span>
								<DraftState publish={flow.batch!.publish.get(row.id)} row={row} />
							</span>
							<Button onPress={() => flow.onOpenRecord(itemKey)} size="xs" variant="transparent">
								Open
							</Button>
						</li>
					))}
				</ul>
				<ImportPager label="Pages of new drafts" onChange={setPage} page={current} pages={pages} perPage={ROWS_PER_PAGE} total={view.drafts.length} />
			</div>
		</div>
	);
}

/** What publishing does, beside the button that does it. */
export function DoneHint({ flow }: { flow: ImportFlowState }) {
	if (flow.stage !== "done" || !flow.batch) return null;
	const view = publishView(flow.batch, flow.choosePublish);
	if (!view.publishable.length) return <p className="min-w-0 flex-1 text-xs leading-5 text-black/50 dark:text-white/50">They stay in Drafts until someone publishes them</p>;
	return <p className="min-w-0 flex-1 text-xs leading-5 text-black/50 dark:text-white/50">{view.started ? "Each published record gets its DOI from the Zenodo sandbox" : "The rest stay in Drafts"}</p>;
}
