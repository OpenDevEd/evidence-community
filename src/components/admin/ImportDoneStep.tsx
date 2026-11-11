"use client";

import { AlertCircleIcon, Attachment01Icon, CheckmarkCircle02Icon, Copy01Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";

import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";

import { useAdminSession } from "./AdminSessionProvider";
import { DraftState, publishView } from "./ImportDone";
import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import { Switch } from "@/components/nextui/Switch";

import { InspectorChoices } from "./InspectorChoices";
import { CheckMeter } from "./ImportReview";
import { DOI_PROVIDER_HELP, doiProviderOptions } from "./PublishingChoicePanel";
import { checkCountOf, countSummary, ListHeader, Setting, SettingsGroup, sheetTransition, SummaryRow, Tick } from "./import-parts";
import { coverOf, routeOf, type ImportBatch } from "./admin-import";
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
	const view = publishView(flow.batch!, flow.choosePublish, canPublish);
	const { current, items, pages } = pageOf(view.drafts, page, ROWS_PER_PAGE);
	const reduceMotion = useReducedMotion();
	// Every row is known once the import returns, so none appears later and pushes the list.
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5 pt-5 [scrollbar-gutter:stable]">
			<DoneSummary flow={flow} view={view} />
			<div className="flex flex-col gap-2">
				<DraftsHeader view={view} />
				{/* A draft slides to its place as it goes on; one moving to another page fades out, and the one taking its place
				   fades in. Turning the page starts the list afresh. */}
				<ul className="relative flex flex-col" key={current}>
					<AnimatePresence initial={false} mode="popLayout">
						{items.map((draft) => (
							<motion.li animate={{ opacity: 1 }} className="flex min-h-16 items-center gap-3 rounded-lg pe-1 ps-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]" exit={{ opacity: 0 }} initial={{ opacity: 0 }} key={draft.row.id} layout={reduceMotion ? false : "position"} transition={sheetTransition(reduceMotion, 0.32)}>
								<DraftRow draft={draft} flow={flow} view={view} />
							</motion.li>
						))}
					</AnimatePresence>
				</ul>
				<ImportPager label="Pages of new drafts" onChange={setPage} page={current} pages={pages} perPage={ROWS_PER_PAGE} total={view.drafts.length} />
			</div>
		</div>
	);
}

type PublishView = ReturnType<typeof publishView>;

/** What the import did, as rows, and the DOI route for the drafts made in the library. */
function DoneSummary({ flow, view }: { flow: ImportFlowState; view: PublishView }) {
	return (
		<SettingsGroup>
			<SummaryRow icon={CheckmarkCircle02Icon} title="Drafts created" tone="text-emerald-700 dark:text-emerald-400" value={view.drafts.length} />
			<PdfsAttached view={view} />
			{view.existing ? <SummaryRow icon={Copy01Icon} title="Already in the community" value={view.existing} /> : null}
			{view.failed ? <SummaryRow icon={AlertCircleIcon} title="Not imported" tone="text-danger" value={view.failed} /> : null}
			<DoiRoute flow={flow} view={view} />
		</SettingsGroup>
	);
}

function PdfsAttached({ view }: { view: PublishView }) {
	if (!view.pdfs) return null;
	return <SummaryRow icon={Attachment01Icon} title="PDFs attached" tone={view.failedPdfs ? "text-amber-700 dark:text-amber-400" : ""} value={`${view.attached} of ${view.pdfs}`} />;
}

/** The DOI route for drafts made in the library; drafts that came with a DOI keep theirs. */
function DoiRoute({ flow, view }: { flow: ImportFlowState; view: PublishView }) {
	const { doiProviders } = useAdminSession();
	// With no Zenodo there is no DOI to choose: the drafts publish without one.
	if (!view.created || !doiProviders.zenodo) return null;
	const route = routeOf(flow.batch!);
	return (
		<Setting icon={Link01Icon} summary={route ? ROUTE_LABELS[route] : "None"} title="DOI provider">
			<DoiChoice flow={flow} route={route} started={view.routeHeld} />
		</Setting>
	);
}

/** Whether the drafts get a DOI, switched on as on a record of its own, and from which provider. */
export function DoiChoice({ flow, route, started }: { flow: ImportFlowState; route: ImportBatch["publishRoute"]; started: boolean }) {
	const { doiProviders } = useAdminSession();
	if (!doiProviders.zenodo) return null;
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<span className="text-xs font-medium text-black/80 dark:text-white/85">Register a DOI</span>
				<Switch aria-label="Register a DOI" color="accent" isDisabled={started} isSelected={Boolean(route)} onValueChange={(selected) => flow.setPublishRoute(selected ? "zenodo" : null)} />
			</div>
			{route ? <InspectorChoices disabled={started} label="DOI provider" onChange={flow.setPublishRoute} options={doiProviderOptions(null, "reuse-crossref", doiProviders.crossref)} value={route} variant="inset" /> : null}
			<p className="text-xs leading-5 text-black/50 dark:text-white/50">{route ? DOI_PROVIDER_HELP[route] : "Publish without a DOI or Zenodo archive."} Drafts that came with a DOI keep it.</p>
		</div>
	);
}

/** How many drafts there are, or, when they can be sent on, how many are chosen and how many went. */
function DraftsHeader({ view }: { view: PublishView }) {
	if (!view.offered) return <ListHeader title={countSummary(view.drafts.length, "draft", "drafts", "0 drafts")} />;
	if (view.serverSending) return <ListHeader lead={<Tick>{null}</Tick>} title={`${view.verbs.doing} as their PDFs attach`} />;
	return <ListHeader {...draftsHeading(view)} lead={<Tick>{view.choosing ? <ChooseEveryDraft view={view} /> : null}</Tick>} />;
}

/** Before sending, how many are chosen and how many pass; after, how many went. */
function draftsHeading(view: PublishView) {
	if (view.started) return { title: `${view.sent} of ${view.chosen.size} ${view.verbs.done}` };
	if (!view.publishable.length && view.sent) return { title: `${view.sent} ${view.verbs.done}` };
	return { aside: `${view.passing} pass every check`, title: `${view.chosen.size} of ${view.publishable.length} ${view.verbs.to}` };
}

function ChooseEveryDraft({ view }: { view: PublishView }) {
	return <Checkbox aria-label={`Choose every draft ${view.verbs.to}`} isIndeterminate={view.chosen.size > 0 && !view.all} isSelected={view.all} onValueChange={view.toggleAll} size="sm" />;
}

const draftTitle = (row: ImportFlowState["shown"][number]) => row.record?.title ?? row.record?.source;

function DraftRow({ draft, flow, view }: { draft: PublishView["drafts"][number]; flow: ImportFlowState; view: PublishView }) {
	const { itemKey, row } = draft;
	return (
		<>
			<DraftChoice id={row.id} title={draftTitle(row)} view={view} />
			<ImportCover className="w-8" {...coverOf(row)} size={12} />
			<span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
				<span className="line-clamp-2 text-sm font-medium leading-5 text-black/85 dark:text-white/85">{draftTitle(row)}</span>
				{/* Where it stands, then its checks as the review's list shows them, on every draft alike. */}
				<span className="flex items-center gap-2">
					{/* A flex box, so a state that is only text keeps its own line height as it changes. */}
					<span className="flex min-w-0 flex-1">
						<DraftState attach={flow.batch!.attach.get(row.id)} draft={draft} publish={flow.batch!.publish.get(row.id)} server={flow.batch!.sending[row.id]} verbs={view.verbs} />
					</span>
					<CheckMeter checks={flow.checksOf(row)} count={checkCountOf(flow, row)} />
				</span>
			</span>
			<Button onPress={() => flow.onOpenRecord(itemKey)} size="xs" variant="transparent">
				Open
			</Button>
		</>
	);
}

/** The tick that sends a draft on, on a draft that can go while nothing is sending. */
function DraftChoice({ id, title, view }: { id: string; title: string | undefined; view: PublishView }) {
	if (!view.offered) return null;
	return <Tick>{view.choosing && view.publishable.includes(id) ? <Checkbox aria-label={`${view.verbs.act} ${title}`} isSelected={view.chosen.has(id)} onValueChange={(checked) => view.toggle(id, checked)} size="sm" /> : null}</Tick>;
}
