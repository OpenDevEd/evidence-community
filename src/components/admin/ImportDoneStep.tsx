"use client";

import { AlertCircleIcon, Attachment01Icon, CheckmarkCircle02Icon, Copy01Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";

import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";

import { useAdminSession } from "./AdminSessionProvider";
import { DraftState, publishView } from "./ImportDone";
import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import { InspectorChoices } from "./InspectorChoices";
import { DOI_PROVIDER_HELP, doiProviderOptions } from "./PublishingChoicePanel";
import { ListHeader, Setting, SettingsGroup, SummaryRow } from "./import-parts";
import type { ImportFlowState } from "./import-flow";

const ROWS_PER_PAGE = 8;

const ROUTE_LABELS = { "crossref-zenodo": "Crossref + Zenodo", zenodo: "Zenodo" } as const;

/**
 * The finish step, built like the Add step: what the import did as a group
 * of rows at the top, then the new drafts as a list. Drafts made from PDFs
 * get their DOI route here and are ticked to send on: editors and owners
 * publish them, anyone else submits them for review, as in the inspector.
 */
export function ImportDoneStep({ flow }: { flow: ImportFlowState }) {
	const [page, setPage] = useState(1);
	const { canPublish } = useAdminSession();
	const batch = flow.batch!;
	const view = publishView(batch, flow.choosePublish, canPublish);
	const { current, items, pages } = pageOf(view.drafts, page, ROWS_PER_PAGE);
	const publishing = view.offered;
	// Every row is known once the import returns, so none appears later and pushes the list.
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5 pt-5 [scrollbar-gutter:stable]">
			<SettingsGroup>
				<SummaryRow icon={CheckmarkCircle02Icon} title="Drafts created" tone="text-emerald-700 dark:text-emerald-400" value={view.drafts.length} />
				{view.pdfs ? <SummaryRow icon={Attachment01Icon} title="PDFs attached" tone={view.failedPdfs ? "text-amber-700 dark:text-amber-400" : ""} value={`${view.attached} of ${view.pdfs}`} /> : null}
				{view.existing ? <SummaryRow icon={Copy01Icon} title="Already in the library" value={view.existing} /> : null}
				{view.failed ? <SummaryRow icon={AlertCircleIcon} title="Not imported" tone="text-danger" value={view.failed} /> : null}
				{view.created ? (
					<Setting icon={Link01Icon} summary={ROUTE_LABELS[batch.publishRoute]} title="DOI provider">
						<div className="flex flex-col gap-2">
							<InspectorChoices disabled={view.started} label="DOI provider" onChange={flow.setPublishRoute} options={doiProviderOptions(null, "reuse-crossref")} value={batch.publishRoute} variant="inset" />
							<p className="text-xs leading-5 text-black/50 dark:text-white/50">{DOI_PROVIDER_HELP[batch.publishRoute]} Drafts that came with a DOI keep it.</p>
						</div>
					</Setting>
				) : null}
			</SettingsGroup>
			<div className="flex flex-col gap-2">
				<ListHeader
					aside={publishing && !view.started ? `${view.passing} pass every check` : undefined}
					lead={publishing ? <Checkbox aria-label={`Choose every draft ${view.verbs.to}`} isDisabled={view.started || !view.publishable.length} isIndeterminate={view.chosen.size > 0 && !view.all} isSelected={view.all} onValueChange={view.toggleAll} size="sm" /> : undefined}
					title={publishing ? (view.started ? `${view.sent} of ${view.chosen.size} ${view.verbs.done}` : `${view.chosen.size} of ${view.publishable.length} ${view.verbs.to}`) : `${view.drafts.length} ${view.drafts.length === 1 ? "draft" : "drafts"}`}
				/>
				<ul className="flex flex-col">
					{items.map((draft) => {
						const { itemKey, row } = draft;
						const title = row.record?.title ?? row.record?.source;
						return (
							<li className="flex min-h-16 items-center gap-3 rounded-lg pe-1 ps-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]" key={row.id}>
								{publishing ? <Checkbox aria-label={`${view.verbs.act} ${title}`} isDisabled={view.started || !view.publishable.includes(row.id)} isSelected={view.chosen.has(row.id)} onValueChange={(checked) => view.toggle(row.id, checked)} size="sm" /> : null}
								<ImportCover className="w-8" file={row.file} itemType={row.record?.itemType} size={12} />
								<span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
									<span className="line-clamp-2 text-sm font-medium leading-5 text-black/85 dark:text-white/85">{title}</span>
									<DraftState attach={batch.attach.get(row.id)} draft={draft} publish={batch.publish.get(row.id)} verbs={view.verbs} />
								</span>
								<Button onPress={() => flow.onOpenRecord(itemKey)} size="xs" variant="transparent">
									Open
								</Button>
							</li>
						);
					})}
				</ul>
				<ImportPager label="Pages of new drafts" onChange={setPage} page={current} pages={pages} perPage={ROWS_PER_PAGE} total={view.drafts.length} />
			</div>
		</div>
	);
}
