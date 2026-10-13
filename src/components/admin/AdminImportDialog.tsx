"use client";

import { ArrowDown01Icon, ArrowRight02Icon, Cancel01Icon, FileExportIcon, SquareArrowUpRight02Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";

import { DraftState, publishView } from "./ImportDone";
import { BibliographyInput, ChecksEditor, DoiInput, DropArea, DropText, PDF_ACCEPT, withNew } from "./ImportInputs";
import { ImportCover } from "./ImportCover";
import { ImportSteps } from "./ImportSteps";
import { Abstract, CheckMeter, Checks, creatorsLine, DetailSection, MetadataLine, openWithProperties, PdfPropertiesList, propertiesAside, ReadingPlaceholder, ReviewBar, RightsFixLine, rowStatus, StatusText, TopicList, usd } from "./ImportReview";
import { checkPasses, FILE_CHECKS, PDF_IMPORT_MAX_FILES, type ImportRow } from "./admin-import";
import { FileChecksList, InputNote, inSentence, NarrowPager, PdfRows, SourceTabs, StageFade } from "./import-design-parts";
import { action, CollectionsButton, DesignSwitch, type ImportFlowState } from "./import-flow";
import { pageOf } from "./ImportPager";

const ROWS_PER_PAGE = 7;

/**
 * Design 5, the side sheet: the import slides in over the admin's record
 * table, which stays in view. Everything runs in one column: what to add,
 * the records opening in place one at a time, and the drafts to publish.
 */
export function DesignDrawer({ flow }: { flow: ImportFlowState }) {
	const { batch, stage } = flow;
	const view = stage === "done" && batch ? publishView(batch, flow.choosePublish) : null;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="shrink-0 border-b border-black/[0.06] px-5 pb-3 pt-4 dark:border-white/[0.06]">
				<div className="flex items-center gap-3">
					<h2 className="text-base font-semibold text-black/90 dark:text-white/90">Import records</h2>
					<span className="ms-auto">
						<ImportSteps stage={stage} />
					</span>
					<Button aria-label="Close" className="size-8 min-w-8" isIconOnly onPress={flow.onClose} size="xs" variant="transparent">
						<HugeiconsIcon aria-hidden icon={Cancel01Icon} size={16} />
					</Button>
				</div>
				<div className="mt-2.5">
					<DesignSwitch />
				</div>
			</header>
			<StageFade stage={stage}>
				{stage === "input" ? <DrawerInput flow={flow} /> : null}
				{stage === "review" && batch ? <DrawerReview flow={flow} /> : null}
				{view ? <DrawerDrafts flow={flow} /> : null}
			</StageFade>
			<footer className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-t border-black/[0.06] px-5 py-3 dark:border-white/[0.06]">
				{stage === "input" || flow.error ? <InputNote flow={flow} /> : null}
				{stage === "review" && !flow.error ? <CollectionsButton collections={batch?.collections ?? []} locked={flow.locked} onChange={flow.setCollections} sources={flow.sources} /> : null}
				<span className="ms-auto flex items-center gap-2">
					{stage === "input" ? (
						<Button className="min-w-28" color="accent" isDisabled={flow.problem !== null} isLoading={flow.busy} onPress={flow.start} size="sm" variant="solid">
							{flow.primaryLabel}
						</Button>
					) : null}
					{stage === "review" ? (
						<>
							<Button isDisabled={flow.locked} onPress={flow.restart} size="sm" variant="transparent">
								Back
							</Button>
							<Button className="min-w-32" color="accent" isDisabled={flow.reading || flow.selected.size === 0} isLoading={flow.locked} onPress={flow.commit} size="sm" variant="solid">
								{action("Import", flow.selected.size, "record", "records")}
							</Button>
						</>
					) : null}
					{view ? (
						<>
							<Button onPress={flow.restart} size="sm" variant="transparent">
								Import more
							</Button>
							{view.publishable.length ? (
								<Button className="min-w-40" color="accent" isDisabled={view.started || !view.chosen.size} onPress={() => flow.publish([...view.chosen])} size="sm" variant="solid">
									{view.publishLabel}
								</Button>
							) : null}
							<Button className="min-w-20" onPress={flow.finish} size="sm" variant="muted">
								Done
							</Button>
						</>
					) : null}
				</span>
			</footer>
		</div>
	);
}

function DrawerInput({ flow }: { flow: ImportFlowState }) {
	const reduceMotion = useReducedMotion();
	const [checksOpen, setChecksOpen] = useState(false);
	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
			<SourceTabs
				dois={<DoiInput busy={flow.busy} narrow onChange={flow.setDoiText} text={flow.doiText} />}
				files={<BibliographyInput busy={flow.busy} files={flow.files} onFilesChange={flow.setFiles} />}
				flow={flow}
				panel="px-0 pb-0 pt-4"
				pdfs={
					<div className="flex flex-col gap-5">
						<DropArea accept={PDF_ACCEPT} busy={flow.busy} className={flow.pdfs.length ? "h-20" : "h-48"} label="PDFs" onFiles={(chosen) => flow.setPdfs(withNew(flow.pdfs, chosen))}>
							<DropText hint={`Up to ${PDF_IMPORT_MAX_FILES} PDFs, 50 MB each.`} what="PDFs" />
						</DropArea>
						{flow.pdfs.length ? <PdfRows busy={flow.busy} files={flow.pdfs} onFilesChange={flow.setPdfs} perPage={6} /> : null}
						<section className="border-t border-black/[0.06] pt-3 dark:border-white/[0.06]">
							<button aria-expanded={checksOpen} className="flex h-9 w-full items-center gap-2 rounded-lg px-1 text-start outline-none hover:bg-black/[0.03] focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/[0.04]" onClick={() => setChecksOpen(!checksOpen)} type="button">
								<span className="text-sm font-medium text-black/85 dark:text-white/85">Checks</span>
								<span className="text-xs tabular-nums text-black/45 dark:text-white/45">
									{flow.checks.length} for this library, {FILE_CHECKS.length} from the file
								</span>
								<HugeiconsIcon aria-hidden className={`ms-auto text-black/40 transition-transform duration-200 dark:text-white/40 ${checksOpen ? "rotate-180" : ""}`} icon={ArrowDown01Icon} size={15} />
							</button>
							<AnimatePresence initial={false}>
								{checksOpen ? (
									<motion.div animate={{ height: "auto", opacity: 1 }} className="overflow-hidden" exit={{ height: 0, opacity: 0 }} initial={{ height: 0, opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.2 }}>
										<div className="pb-2 pt-3">
											<ChecksEditor busy={flow.busy} criteria={flow.checks} fileNote={false} onChange={flow.setChecks} />
											<p className="mb-1 mt-4 text-xs text-black/45 dark:text-white/45">From the file itself, for every PDF</p>
											<FileChecksList />
										</div>
									</motion.div>
								) : null}
							</AnimatePresence>
						</section>
					</div>
				}
			/>
		</div>
	);
}

/** The records as a column; one opens in place at a time. */
function DrawerReview({ flow }: { flow: ImportFlowState }) {
	const batch = flow.batch!;
	const [page, setPage] = useState(1);
	const [openId, setOpenId] = useState<string | null>(flow.activeRow?.id ?? null);
	const { current, items, pages } = pageOf(flow.shown, page, ROWS_PER_PAGE);
	const all = flow.readyIds.length > 0 && flow.readyIds.every((id) => flow.selected.has(id));
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="shrink-0 px-4 py-2.5">
				<ReviewBar costUsd={flow.costUsd} counts={flow.counts} filter={flow.filter} kind={batch.kind} onFilter={flow.setFilter} progress={false} />
			</div>
			<div className="flex h-9 shrink-0 items-center gap-3 border-y border-black/[0.06] px-5 text-xs text-black/50 dark:border-white/[0.06] dark:text-white/50">
				<Checkbox aria-label="Choose every ready record" isDisabled={flow.locked || !flow.readyIds.length} isIndeterminate={flow.selected.size > 0 && !all} isSelected={all} onValueChange={(checked) => flow.setSelected(new Set(checked ? flow.readyIds : []))} size="sm" />
				<span className="tabular-nums">
					{flow.selected.size} of {flow.readyIds.length} chosen
				</span>
				{batch.kind === "pdfs" ? <span className="ms-auto tabular-nums">{flow.counts.done < flow.counts.total ? `${flow.counts.done} of ${flow.counts.total} read` : `Read for ${usd(flow.costUsd)}`}</span> : null}
			</div>
			<ul className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
				{items.map((row) => (
					<DrawerRow flow={flow} key={row.id} onToggle={() => setOpenId(openId === row.id ? null : row.id)} open={openId === row.id} row={row} />
				))}
				{!items.length ? <li className="flex h-28 items-center justify-center text-sm text-black/45 dark:text-white/45">Nothing here</li> : null}
			</ul>
			<div className="shrink-0 px-5 pb-2">
				<NarrowPager onChange={setPage} page={current} pages={pages} perPage={ROWS_PER_PAGE} total={flow.shown.length} />
			</div>
		</div>
	);
}

function DrawerRow({ flow, onToggle, open, row }: { flow: ImportFlowState; onToggle: () => void; open: boolean; row: ImportRow }) {
	const reduceMotion = useReducedMotion();
	const title = row.record?.title ?? row.file?.name ?? row.record?.source ?? "";
	const status = rowStatus(row, flow.resultById.get(row.id), flow.batch!.attach.get(row.id));
	return (
		<li className={`rounded-xl transition-colors duration-150 ${open ? "bg-black/[0.035] dark:bg-white/[0.05]" : ""}`}>
			<div className="flex min-h-16 items-center gap-3 px-2 py-2">
				<Checkbox
					aria-label={`Import ${title}`}
					isDisabled={flow.locked || row.record?.state !== "ready"}
					isSelected={flow.selected.has(row.id)}
					onValueChange={(checked) => {
						const next = new Set(flow.selected);
						if (checked) next.add(row.id);
						else next.delete(row.id);
						flow.setSelected(next);
					}}
					size="sm"
				/>
				<button aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={onToggle} type="button">
					<ImportCover className="w-8" file={row.file} itemType={row.record?.itemType} reading={row.state === "reading"} size={12} />
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className={`line-clamp-2 text-sm leading-5 ${row.record?.title ? "font-medium text-black/85 dark:text-white/85" : "text-black/45 dark:text-white/45"}`}>{title}</span>
						<span className="flex items-center gap-2">
							{status.label === "Ready" && row.record ? <span className="min-w-0 flex-1 truncate text-xs text-black/50 dark:text-white/50">{creatorsLine(row.record.creators) || "No authors"}</span> : <span className="min-w-0 flex-1"><StatusText status={status} /></span>}
							<CheckMeter checks={flow.checksOf(row)} count={row.file ? flow.checkCount : 0} />
						</span>
					</span>
					<HugeiconsIcon aria-hidden className={`shrink-0 text-black/35 transition-transform duration-200 dark:text-white/35 ${open ? "rotate-180" : ""}`} icon={ArrowDown01Icon} size={15} />
				</button>
			</div>
			<AnimatePresence initial={false}>
				{open ? (
					<motion.div animate={{ height: "auto", opacity: 1 }} className="overflow-hidden" exit={{ height: 0, opacity: 0 }} initial={{ height: 0, opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.32, 0.72, 0, 1] }}>
						<div className="px-4 pb-5 pt-1">
							<DrawerRecord flow={flow} row={row} />
						</div>
					</motion.div>
				) : null}
			</AnimatePresence>
		</li>
	);
}

function DrawerRecord({ flow, row }: { flow: ImportFlowState; row: ImportRow }) {
	const record = row.record;
	const payload = record?.payload ?? {};
	const abstract = typeof payload.abstractNote === "string" ? payload.abstractNote : null;
	const settled = row.state === "read" || row.state === "failed";
	const checks = flow.checksOf(row);
	const result = flow.resultById.get(row.id);
	const openKey = result?.itemKey ?? record?.existingKey;
	const properties = flow.propertiesOf(row);
	if (!settled) return <ReadingPlaceholder />;
	return (
		<div className="flex flex-col gap-6">
			{record?.creators.length ? <p className="text-sm text-black/60 dark:text-white/60">{record.creators.join(", ")}</p> : null}
			{record ? <MetadataLine payload={payload} /> : null}
			{row.message ? <p className="text-xs text-danger">{row.message}</p> : null}
			{abstract ? (
				<DetailSection aside={row.abstractWritten ? "Written by AI" : undefined} title="Abstract">
					<Abstract text={abstract} />
				</DetailSection>
			) : null}
			{row.file && flow.checkCount ? (
				<DetailSection aside={`${checks.filter(checkPasses).length} of ${flow.checkCount} pass`} title="Checks">
					<Checks checks={checks}>{row.rightsFix ? <RightsFixLine applied={row.fixApplied} fix={row.rightsFix} locked={flow.locked} onToggle={() => flow.toggleFix(row.id)} stated={typeof payload.rights === "string" ? payload.rights : ""} /> : null}</Checks>
				</DetailSection>
			) : null}
			{row.topics.length ? (
				<DetailSection aside={`${flow.topicsOf(row).size} of ${row.topics.length} chosen`} title="Topics">
					<TopicList chosen={flow.topicsOf(row)} locked={flow.locked} onToggle={(topicId) => flow.toggleTopic(row.id, topicId)} topics={row.topics} />
				</DetailSection>
			) : null}
			{row.file && record && row.pdf ? (
				<DetailSection aside={propertiesAside(properties, row.pdf)} title="PDF properties">
					<PdfPropertiesList after={properties} now={row.pdf} />
				</DetailSection>
			) : null}
			<div className="flex flex-wrap gap-2">
				{row.file ? (
					<Button onPress={() => window.open(URL.createObjectURL(row.file!), "_blank", "noopener")} size="xs" startContent={<HugeiconsIcon aria-hidden icon={SquareArrowUpRight02Icon} size={13} />} variant="muted">
						Open PDF
					</Button>
				) : null}
				{row.file && record && row.pdf?.writable ? (
					<Button onPress={() => void openWithProperties(row.file!, properties)} size="xs" startContent={<HugeiconsIcon aria-hidden icon={FileExportIcon} size={13} />} variant="muted">
						With new properties
					</Button>
				) : null}
				{openKey ? (
					<Button onPress={() => flow.onOpenRecord(openKey)} size="xs" startContent={<HugeiconsIcon aria-hidden icon={ArrowRight02Icon} size={13} />} variant="muted">
						{result?.itemKey ? "Open the draft" : "Open the record"}
					</Button>
				) : null}
			</div>
		</div>
	);
}

function DrawerDrafts({ flow }: { flow: ImportFlowState }) {
	const [page, setPage] = useState(1);
	const view = publishView(flow.batch!, flow.choosePublish);
	const { current, items, pages } = pageOf(view.drafts, page, ROWS_PER_PAGE);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="shrink-0 px-5 pb-3 pt-5">
				<h3 className="text-lg font-semibold tabular-nums text-black/90 dark:text-white/90">{view.headline}</h3>
				<p className="mt-1 text-sm text-black/55 dark:text-white/55">
					{view.started ? "Each published record gets its DOI from the Zenodo sandbox." : view.publishable.length ? `${view.passing} of ${view.publishable.length} pass every check and start ticked.` : "They stay in Drafts until someone publishes them."}
				</p>
				{view.tally.length ? <p className="mt-2 text-xs tabular-nums text-black/50 dark:text-white/50">{view.tally.map((line) => `${line.count} ${inSentence(line.label)}`).join(", ")}</p> : null}
			</div>
			{view.publishable.length ? (
				<div className="flex h-9 shrink-0 items-center gap-3 border-y border-black/[0.06] px-5 text-xs text-black/50 dark:border-white/[0.06] dark:text-white/50">
					<Checkbox aria-label="Choose every draft to publish" isDisabled={view.started} isIndeterminate={view.chosen.size > 0 && !view.all} isSelected={view.all} onValueChange={view.toggleAll} size="sm" />
					<span className="tabular-nums">
						{view.chosen.size} of {view.publishable.length} to publish
					</span>
				</div>
			) : null}
			<ul className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
				{items.map(({ itemKey, row }) => (
					<li className="flex min-h-16 items-center gap-3 rounded-lg px-2 py-2 hover:bg-black/[0.025] dark:hover:bg-white/[0.03]" key={row.id}>
						{view.publishable.length ? <Checkbox aria-label={`Publish ${row.record?.title ?? row.record?.source}`} isDisabled={view.started || !row.file} isSelected={view.chosen.has(row.id)} onValueChange={(checked) => view.toggle(row.id, checked)} size="sm" /> : null}
						<ImportCover className="w-8" file={row.file} itemType={row.record?.itemType} size={12} />
						<span className="flex min-w-0 flex-1 flex-col gap-0.5">
							<span className="line-clamp-2 text-sm leading-5 text-black/85 dark:text-white/85">{row.record?.title ?? row.record?.source}</span>
							<DraftState publish={flow.batch!.publish.get(row.id)} row={row} />
						</span>
						<Button onPress={() => flow.onOpenRecord(itemKey)} size="xs" variant="transparent">
							Open
						</Button>
					</li>
				))}
			</ul>
			<div className="shrink-0 px-5 pb-2">
				<NarrowPager onChange={setPage} page={current} pages={pages} perPage={ROWS_PER_PAGE} total={view.drafts.length} />
			</div>
		</div>
	);
}
