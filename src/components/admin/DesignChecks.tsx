"use client";

import { ArrowLeft01Icon, ArrowRight01Icon, Tick02Icon, Undo02Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";
import { PDF_IMPORT_MAX_CRITERIA, type PdfCheckResult } from "@/lib/admin/item-import-contract";

import { DraftState, publishView } from "./ImportDone";
import { BibliographyInput, ChecksEditor, DoiInput, DropArea, DropText, PDF_ACCEPT, withNew } from "./ImportInputs";
import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import { lookOf, ReviewDetail, ReviewList, usd } from "./ImportReview";
import { checkPasses, FILE_CHECKS, PDF_IMPORT_MAX_FILES, rowPasses, type ImportRow, type ReviewCheck } from "./admin-import";
import { DesignHeader, FileChecksList, InputNote, inSentence, PdfRows, SourceTabs, StageFade } from "./import-design-parts";
import { action, CollectionsButton, type ImportFlowState } from "./import-flow";

const GROUP_PER_PAGE = 6;

/**
 * Design 4, by check: the review is organised around the library's checks.
 * Each check shows how many records pass it, and opening one lists the
 * records that fail, are unclear or pass, with the AI's quote and a fix for
 * the whole group. Records open on top when needed.
 */
export function DesignChecks({ flow }: { flow: ImportFlowState }) {
	const { batch, stage } = flow;
	const view = stage === "done" && batch ? publishView(batch, flow.choosePublish) : null;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<DesignHeader stage={stage} />
			<StageFade stage={stage}>
				{stage === "input" ? <ChecksFirstInput flow={flow} /> : null}
				{stage === "review" && batch ? <CheckBoard flow={flow} /> : null}
				{stage === "done" && batch?.results ? <OutcomeGroups flow={flow} /> : null}
			</StageFade>
			<footer className="flex h-16 shrink-0 items-center gap-3 border-t border-black/[0.06] px-6 dark:border-white/[0.06]">
				{stage === "input" || flow.error ? <InputNote flow={flow} /> : null}
				{stage === "review" && !flow.error ? <CollectionsButton collections={batch?.collections ?? []} locked={flow.locked} onChange={flow.setCollections} sources={flow.sources} /> : null}
				<span className="ms-auto flex items-center gap-2">
					{stage === "input" ? (
						<>
							<Button isDisabled={flow.busy} onPress={flow.onClose} size="sm" variant="transparent">
								Cancel
							</Button>
							<Button className="min-w-28" color="accent" isDisabled={flow.problem !== null} isLoading={flow.busy} onPress={flow.start} size="sm" variant="solid">
								{flow.primaryLabel}
							</Button>
						</>
					) : null}
					{stage === "review" ? (
						<>
							<Button isDisabled={flow.locked} onPress={flow.restart} size="sm" variant="transparent">
								Back
							</Button>
							<Button onPress={flow.onClose} size="sm" variant="transparent">
								Close
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
							<Button className="min-w-20" onPress={flow.finish} size="sm" variant="muted">
								Done
							</Button>
							{view.publishable.length ? (
								<Button className="min-w-44" color="accent" isDisabled={view.started || !view.chosen.size} onPress={() => flow.publish([...view.chosen])} size="sm" variant="solid">
									{view.publishLabel}
								</Button>
							) : null}
						</>
					) : null}
				</span>
			</footer>
		</div>
	);
}

/** The checks lead: they decide what the review is about. The PDFs go beside them. */
function ChecksFirstInput({ flow }: { flow: ImportFlowState }) {
	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
			<SourceTabs
				dois={<DoiInput busy={flow.busy} onChange={flow.setDoiText} text={flow.doiText} />}
				files={<BibliographyInput busy={flow.busy} files={flow.files} onFilesChange={flow.setFiles} />}
				flow={flow}
				pdfs={
					<div className="grid min-h-full grid-cols-[minmax(0,1fr)_26rem] gap-10">
						<div className="max-w-[34rem]">
							<h3 className="flex items-baseline gap-3 text-lg font-semibold text-black/90 dark:text-white/90">
								What every PDF is checked for
								<span className="ms-auto text-xs font-normal tabular-nums text-black/45 dark:text-white/45">{flow.checks.length} of {PDF_IMPORT_MAX_CRITERIA} for this library</span>
							</h3>
							<p className="mb-5 mt-1 text-sm text-black/55 dark:text-white/55">The review is organised by these. The AI answers each one with the quote and page it rests on; the last three come from the file itself.</p>
							<ChecksEditor busy={flow.busy} criteria={flow.checks} fileNote={false} heading={false} onChange={flow.setChecks} />
							<div className="mt-2">
								<FileChecksList />
							</div>
						</div>
						<div className="flex flex-col gap-3 border-s border-black/[0.06] ps-8 dark:border-white/[0.06]">
							<h3 className="text-sm font-medium text-black/85 dark:text-white/85">{flow.pdfs.length ? `${flow.pdfs.length} ${flow.pdfs.length === 1 ? "PDF" : "PDFs"}` : "PDFs"}</h3>
							<DropArea accept={PDF_ACCEPT} busy={flow.busy} className={flow.pdfs.length ? "h-20" : "min-h-[28rem]"} label="PDFs" onFiles={(chosen) => flow.setPdfs(withNew(flow.pdfs, chosen))}>
								<DropText hint={`Up to ${PDF_IMPORT_MAX_FILES} PDFs, 50 MB each.`} what="PDFs" />
							</DropArea>
							{flow.pdfs.length ? <PdfRows busy={flow.busy} files={flow.pdfs} onFilesChange={flow.setPdfs} perPage={8} /> : null}
						</div>
					</div>
				}
			/>
		</div>
	);
}

type Board = { kind: "check"; index: number } | { kind: "records" };

const answered = (check: ReviewCheck | undefined) => (check ? (check.fixed ? "met" : check.result) : null);

/** How one check went across the records, as a bar of passes, unclear answers and failures. */
function CheckBar({ checks }: { checks: (ReviewCheck | undefined)[] }) {
	const total = checks.length || 1;
	const count = (result: PdfCheckResult["result"]) => checks.filter((check) => answered(check) === result).length;
	return (
		<span aria-hidden className="flex h-1.5 w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.08]">
			<span className="bg-emerald-500 transition-[width] duration-500" style={{ width: `${(count("met") / total) * 100}%` }} />
			<span className="bg-amber-500 transition-[width] duration-500" style={{ width: `${(count("unclear") / total) * 100}%` }} />
			<span className="bg-danger transition-[width] duration-500" style={{ width: `${(count("not_met") / total) * 100}%` }} />
		</span>
	);
}

function CheckBoard({ flow }: { flow: ImportFlowState }) {
	const batch = flow.batch!;
	const reduceMotion = useReducedMotion();
	const pdfs = batch.kind === "pdfs";
	const criteria = pdfs ? [...batch.checks, ...FILE_CHECKS.map(({ criterion }) => criterion)] : [];
	const [board, setBoard] = useState<Board>(criteria.length ? { kind: "check", index: 0 } : { kind: "records" });
	const [openId, setOpenId] = useState<string | null>(null);
	const open = batch.rows.find(({ id }) => id === openId) ?? null;
	const answersFor = (index: number) => batch.rows.filter((row) => row.file).map((row) => flow.checksOf(row)[index]);
	const passingRecords = batch.rows.filter((row) => (row.state === "read" ? rowPasses(row) : false)).length;
	const item = (active: boolean) => `flex w-full flex-col gap-2 rounded-lg px-3 py-2.5 text-start outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent ${active ? "bg-black/[0.055] dark:bg-white/[0.08]" : "hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"}`;
	return (
		<div className="grid min-h-0 flex-1 grid-cols-[22rem_minmax(0,1fr)]">
			<nav aria-label="Checks" className="flex min-h-0 flex-col border-e border-black/[0.06] dark:border-white/[0.06]">
				<div className="flex h-12 shrink-0 items-center gap-2 px-5 text-xs tabular-nums text-black/55 dark:text-white/55">
					{flow.counts.done < flow.counts.total ? `${flow.counts.done} of ${flow.counts.total} read` : `${flow.counts.total} read for ${usd(flow.costUsd)}`}
					<span className="ms-auto">{passingRecords} pass every check</span>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
					<button aria-current={board.kind === "records" || undefined} className={item(board.kind === "records")} onClick={() => setBoard({ kind: "records" })} type="button">
						<span className="flex w-full items-center text-sm font-medium text-black/85 dark:text-white/85">
							Every record
							<span className="ms-auto text-xs font-normal tabular-nums text-black/45 dark:text-white/45">{batch.rows.length}</span>
						</span>
					</button>
					{criteria.map((criterion, index) => {
						const answers = answersFor(index);
						const passed = answers.filter((check) => check && checkPasses(check)).length;
						const fileCheck = index >= batch.checks.length;
						return (
							<div key={criterion}>
								{index === batch.checks.length ? <p className="px-3 pb-1 pt-4 text-xs text-black/45 dark:text-white/45">From the file itself</p> : null}
								<button aria-current={(board.kind === "check" && board.index === index) || undefined} className={item(board.kind === "check" && board.index === index)} onClick={() => setBoard({ kind: "check", index })} type="button">
									<span className={`line-clamp-2 text-sm leading-5 ${fileCheck ? "text-black/70 dark:text-white/70" : "text-black/85 dark:text-white/85"}`}>{criterion}</span>
									<CheckBar checks={answers} />
									<span className="text-xs tabular-nums text-black/50 dark:text-white/50">
										{passed} of {answers.length} pass
									</span>
								</button>
							</div>
						);
					})}
				</div>
			</nav>
			<div className="relative min-h-0 overflow-hidden">
				<div className="h-full overflow-y-auto px-8 py-6">{board.kind === "check" ? <CheckDetail criterion={criteria[board.index]!} flow={flow} index={board.index} key={board.index} onOpen={setOpenId} /> : <RecordsOverview flow={flow} onOpen={setOpenId} />}</div>
				<AnimatePresence>
					{open ? (
						<motion.div
							animate={{ opacity: 1, x: 0 }}
							className="absolute inset-0 z-10 flex flex-col bg-background_light dark:bg-card"
							exit={{ opacity: 0, x: 24 }}
							initial={{ opacity: 0, x: 24 }}
							key="record"
							transition={{ duration: reduceMotion ? 0 : 0.18 }}
						>
							<div className="flex h-12 shrink-0 items-center border-b border-black/[0.06] px-5 dark:border-white/[0.06]">
								<Button onPress={() => setOpenId(null)} size="xs" startContent={<HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} size={14} />} variant="transparent">
									{board.kind === "check" ? "Back to the check" : "Back to every record"}
								</Button>
							</div>
							<div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
								<ReviewDetail
									attach={batch.attach.get(open.id)}
									checks={flow.checksOf(open)}
									chosenTopics={flow.topicsOf(open)}
									criteriaCount={flow.checkCount}
									key={open.id}
									locked={flow.locked}
									onOpenRecord={flow.onOpenRecord}
									onToggleFix={() => flow.toggleFix(open.id)}
									onToggleTopic={(topicId) => flow.toggleTopic(open.id, topicId)}
									properties={flow.propertiesOf(open)}
									result={flow.resultById.get(open.id)}
									row={open}
								/>
							</div>
						</motion.div>
					) : null}
				</AnimatePresence>
			</div>
		</div>
	);
}

const GROUPS: { label: string; result: PdfCheckResult["result"] }[] = [
	{ label: "Not met", result: "not_met" },
	{ label: "Unclear", result: "unclear" },
	{ label: "Met", result: "met" },
];

/** One check across the records: the ones to fix first, then the unclear ones, then the passes. */
function CheckDetail({ criterion, flow, index, onOpen }: { criterion: string; flow: ImportFlowState; index: number; onOpen: (id: string) => void }) {
	const rows = flow.batch!.rows.filter((row) => row.file);
	const answer = (row: ImportRow) => flow.checksOf(row)[index];
	const settled = rows.filter((row) => answer(row));
	const fixable = settled.filter((row) => answer(row)!.fixable && !answer(row)!.fixed);
	return (
		<div className="flex max-w-[56rem] flex-col gap-7">
			<header className="flex items-start gap-6">
				<div className="min-w-0 flex-1">
					<h3 className="text-lg font-semibold leading-7 text-black/90 dark:text-white/90">{criterion}</h3>
					<p className="mt-1 text-sm tabular-nums text-black/55 dark:text-white/55">
						{settled.filter((row) => checkPasses(answer(row)!)).length} of {rows.length} records pass{settled.length < rows.length ? `, ${rows.length - settled.length} still being read` : ""}
					</p>
				</div>
				{fixable.length ? (
					<Button className="shrink-0" isDisabled={flow.locked} onPress={() => fixable.forEach((row) => flow.setFix(row.id, true))} size="sm" startContent={<HugeiconsIcon aria-hidden icon={Tick02Icon} size={14} />} variant="muted">
						Apply suggested Rights to {fixable.length}
					</Button>
				) : null}
			</header>
			{GROUPS.map((group) => {
				const members = settled.filter((row) => answered(answer(row)) === group.result);
				return members.length ? <CheckGroup answer={answer} flow={flow} key={group.result} label={group.label} onOpen={onOpen} rows={members} /> : null;
			})}
		</div>
	);
}

function CheckGroup({ answer, flow, label, onOpen, rows }: { answer: (row: ImportRow) => ReviewCheck | undefined; flow: ImportFlowState; label: string; onOpen: (id: string) => void; rows: ImportRow[] }) {
	const [page, setPage] = useState(1);
	const { current, items, pages } = pageOf(rows, page, GROUP_PER_PAGE);
	return (
		<section>
			<h4 className="mb-1 flex h-7 items-center gap-2 text-sm font-medium text-black/80 dark:text-white/80">
				{label}
				<span className="text-xs font-normal tabular-nums text-black/45 dark:text-white/45">{rows.length}</span>
			</h4>
			<ul className="flex flex-col divide-y divide-black/[0.06] border-y border-black/[0.06] dark:divide-white/[0.06] dark:border-white/[0.06]">
				{items.map((row) => {
					const check = answer(row)!;
					const look = lookOf(check);
					const title = row.record?.title ?? row.file?.name ?? "";
					return (
						<li className="flex items-start gap-3 py-3" key={row.id}>
							<span className="pt-1">
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
							</span>
							<ImportCover className="w-9" file={row.file} itemType={row.record?.itemType} size={12} />
							<div className="min-w-0 flex-1">
								<p className="flex items-center gap-2 text-sm">
									<HugeiconsIcon aria-label={look.label} className={`shrink-0 ${look.tone}`} icon={look.icon} size={14} />
									<span className="truncate font-medium text-black/85 dark:text-white/85">{title}</span>
								</p>
								{check.quote ? (
									<p className="mt-1 line-clamp-2 text-xs leading-5 text-black/55 dark:text-white/55">
										{check.file ? check.quote : <q>{check.quote}</q>}
										{check.page ? <span className="ms-1.5 tabular-nums text-black/40 dark:text-white/40">p. {check.page}</span> : null}
									</p>
								) : null}
								{check.recommendation && !check.fixed ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-amber-800 dark:text-amber-300">{check.recommendation}</p> : null}
							</div>
							<span className="flex shrink-0 items-center gap-1">
								{check.fixable ? (
									<Button className="h-8 min-h-8 min-w-[4.5rem]" isDisabled={flow.locked} onPress={() => flow.toggleFix(row.id)} size="xs" startContent={<HugeiconsIcon aria-hidden icon={check.fixed ? Undo02Icon : Tick02Icon} size={12} />} variant={check.fixed ? "transparent" : "muted"}>
										{check.fixed ? "Undo" : "Apply"}
									</Button>
								) : null}
								<Button aria-label={`Open ${title}`} className="size-8 min-w-8" isIconOnly onPress={() => onOpen(row.id)} size="xs" variant="transparent">
									<HugeiconsIcon aria-hidden icon={ArrowRight01Icon} size={15} />
								</Button>
							</span>
						</li>
					);
				})}
			</ul>
			<ImportPager label={`Pages of ${label.toLowerCase()}`} onChange={setPage} page={current} pages={pages} perPage={GROUP_PER_PAGE} total={rows.length} />
		</section>
	);
}

function RecordsOverview({ flow, onOpen }: { flow: ImportFlowState; onOpen: (id: string) => void }) {
	const batch = flow.batch!;
	return (
		<div className="max-w-[44rem]">
			<h3 className="mb-3 text-lg font-semibold text-black/90 dark:text-white/90">Every record</h3>
			<ReviewList
				activeId={null}
				attach={batch.attach}
				checksOf={flow.checksOf}
				criteriaCount={flow.checkCount}
				filter="all"
				locked={flow.locked}
				onActivate={onOpen}
				onSelectedChange={flow.setSelected}
				readyIds={flow.readyIds}
				results={batch.results}
				rows={batch.rows}
				selected={flow.selected}
			/>
		</div>
	);
}

/** The new drafts grouped by outcome, ticked for publishing where every check passes. */
function OutcomeGroups({ flow }: { flow: ImportFlowState }) {
	const view = publishView(flow.batch!, flow.choosePublish);
	const groups = [
		{ drafts: view.drafts.filter(({ row }) => row.file && rowPasses(row)), label: "Pass every check" },
		{ drafts: view.drafts.filter(({ row }) => row.file && !rowPasses(row)), label: "Some checks fail" },
		{ drafts: view.drafts.filter(({ row }) => !row.file), label: "Without a PDF" },
	].filter((group) => group.drafts.length);
	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
			<div className="mx-auto flex max-w-[52rem] flex-col gap-7">
				<div>
					<h3 className="text-xl font-semibold tabular-nums text-black/90 dark:text-white/90">{view.headline}</h3>
					<p className="mt-1 text-sm text-black/55 dark:text-white/55">
						{view.started ? "Each published record gets its DOI from the Zenodo sandbox." : view.publishable.length ? "The ones that pass every check start ticked for publishing." : "They stay in Drafts until someone publishes them."}
						{view.tally.length ? ` ${view.tally.map((line) => `${line.count} ${inSentence(line.label)}`).join(", ")}.` : ""}
					</p>
				</div>
				{groups.map((group) => (
					<DraftGroup drafts={group.drafts} flow={flow} key={group.label} label={group.label} view={view} />
				))}
			</div>
		</div>
	);
}

function DraftGroup({ drafts, flow, label, view }: { drafts: ReturnType<typeof publishView>["drafts"]; flow: ImportFlowState; label: string; view: ReturnType<typeof publishView> }) {
	const [page, setPage] = useState(1);
	const { current, items, pages } = pageOf(drafts, page, GROUP_PER_PAGE);
	return (
		<section>
			<h4 className="mb-1 flex h-7 items-center gap-2 text-sm font-medium text-black/80 dark:text-white/80">
				{label}
				<span className="text-xs font-normal tabular-nums text-black/45 dark:text-white/45">{drafts.length}</span>
			</h4>
			<ul className="flex flex-col divide-y divide-black/[0.06] border-y border-black/[0.06] dark:divide-white/[0.06] dark:border-white/[0.06]">
				{items.map(({ itemKey, row }) => (
					<li className="flex h-14 items-center gap-3" key={row.id}>
						{view.publishable.length ? <Checkbox aria-label={`Publish ${row.record?.title ?? row.record?.source}`} isDisabled={view.started || !row.file} isSelected={view.chosen.has(row.id)} onValueChange={(checked) => view.toggle(row.id, checked)} size="sm" /> : null}
						<ImportCover className="w-7" file={row.file} itemType={row.record?.itemType} size={11} />
						<span className="min-w-0 flex-1 truncate text-sm text-black/85 dark:text-white/85">{row.record?.title ?? row.record?.source}</span>
						<span className="flex w-48 shrink-0 justify-end">
							<DraftState publish={flow.batch!.publish.get(row.id)} row={row} />
						</span>
						<Button onPress={() => flow.onOpenRecord(itemKey)} size="xs" variant="transparent">
							Open
						</Button>
					</li>
				))}
			</ul>
			<ImportPager label={`Pages of ${label.toLowerCase()}`} onChange={setPage} page={current} pages={pages} perPage={GROUP_PER_PAGE} total={drafts.length} />
		</section>
	);
}
