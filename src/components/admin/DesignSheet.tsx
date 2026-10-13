"use client";

import { ArrowRight01Icon, Cancel01Icon, CheckListIcon, LockIcon, MinusSignIcon, PencilEdit02Icon, PlusSignIcon, Tick02Icon, Undo02Icon, Upload04Icon } from "@hugeicons/core-free-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Suspense, use, useState, type CSSProperties } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { estimatePdfImportCost } from "@/lib/admin/item-import-contract";

import { SortHeader } from "./AdminSortHeader";
import { DraftState, publishView } from "./ImportDone";
import { BibliographyInput, ChecksEditor, DoiInput, DropArea, DropText, megabytes, PDF_ACCEPT, RemoveButton, withNew } from "./ImportInputs";
import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import { changeOf, CheckMeter, creatorsLine, lookOf, PROPERTY_ROWS, ReviewBar, ReviewDetail, rowStatus, StatusText, usd } from "./ImportReview";
import { checkPasses, FILE_CHECKS, PDF_IMPORT_MAX_FILES, type ImportRow } from "./admin-import";
import { DesignHeader, ErrorNote, FileChecksList, InputNote, inSentence, PageCount, SourceTabs, StageFade } from "./import-design-parts";
import { action, CollectionsButton, type ImportFlowState } from "./import-flow";
import { pdfPageCount } from "./pdf-thumbnail";

const ROWS_PER_PAGE = 12;
const header = "flex h-9 items-center border-b border-black/[0.06] bg-card_light px-3 text-[11px] font-semibold text-black/40 dark:border-white/[0.06] dark:bg-card dark:text-white/40";
const cell = "flex min-w-0 items-center border-b border-black/[0.06] px-3 dark:border-white/[0.06]";

/**
 * Design 2, the spreadsheet: the import takes the whole screen, the review is
 * one row per record with a column per check, and a row opens its full record
 * in a panel from the right. Sorting, paging and bulk fixes work as in the
 * admin's record table.
 */
export function DesignSheet({ flow }: { flow: ImportFlowState }) {
	const { stage } = flow;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<DesignHeader
				lead={
					<Button aria-label="Close" className="-ms-2 size-8 min-w-8" isIconOnly onPress={flow.onClose} size="xs" variant="transparent">
						<HugeiconsIcon aria-hidden icon={Cancel01Icon} size={16} />
					</Button>
				}
				stage={stage}
			>
				<SheetActions flow={flow} />
			</DesignHeader>
			<StageFade stage={stage}>
				{stage === "input" ? (
					<div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8 pt-4">
						<SourceTabs
							dois={<DoiInput busy={flow.busy} onChange={flow.setDoiText} text={flow.doiText} />}
							files={<BibliographyInput busy={flow.busy} files={flow.files} onFilesChange={flow.setFiles} />}
							flow={flow}
							pdfs={<FileTable flow={flow} />}
						/>
					</div>
				) : null}
				{stage === "review" && flow.batch ? <RecordSheet flow={flow} /> : null}
				{stage === "done" && flow.batch?.results ? <DraftSheet flow={flow} /> : null}
			</StageFade>
		</div>
	);
}

function SheetActions({ flow }: { flow: ImportFlowState }) {
	const { batch, stage } = flow;
	if (stage === "input") {
		return (
			<>
				<InputNote flow={flow} />
				<Button className="min-w-28" color="accent" isDisabled={flow.problem !== null} isLoading={flow.busy} onPress={flow.start} size="sm" variant="solid">
					{flow.primaryLabel}
				</Button>
			</>
		);
	}
	if (stage === "review") {
		return (
			<>
				<ErrorNote flow={flow} />
				<CollectionsButton collections={batch?.collections ?? []} locked={flow.locked} onChange={flow.setCollections} sources={flow.sources} />
				<Button isDisabled={flow.locked} onPress={flow.restart} size="sm" variant="transparent">
					Start over
				</Button>
				<Button className="min-w-32" color="accent" isDisabled={flow.reading || flow.selected.size === 0} isLoading={flow.locked} onPress={flow.commit} size="sm" variant="solid">
					{action("Import", flow.selected.size, "record", "records")}
				</Button>
			</>
		);
	}
	const view = batch ? publishView(batch, flow.choosePublish) : null;
	return (
		<>
			<Button onPress={flow.restart} size="sm" variant="transparent">
				Import more
			</Button>
			{view?.publishable.length ? (
				<Button className="min-w-44" color="accent" isDisabled={view.started || !view.chosen.size} onPress={() => flow.publish([...view.chosen])} size="sm" variant="solid">
					{view.publishLabel}
				</Button>
			) : null}
			<Button className="min-w-20" onPress={flow.finish} size="sm" variant="muted">
				Done
			</Button>
		</>
	);
}

function FileCost({ file }: { file: File }) {
	const pages = use(pdfPageCount(file));
	return pages ? <>{usd(estimatePdfImportCost(pages, 1))}</> : null;
}

/** The chosen PDFs as rows with pages, size and what each costs to read; the checks sit behind a button. */
function FileTable({ flow }: { flow: ImportFlowState }) {
	const [page, setPage] = useState(1);
	const { current, items, pages } = pageOf(flow.pdfs, page, ROWS_PER_PAGE);
	const add = (chosen: File[]) => flow.setPdfs(withNew(flow.pdfs, chosen));
	const columns: CSSProperties = { gridTemplateColumns: "3.25rem minmax(16rem,1fr) 7rem 6rem 7rem 3rem" };
	return (
		<div className="flex flex-col gap-4">
			<div className="flex h-9 items-center gap-3">
				<p className="text-sm font-medium text-black/85 dark:text-white/85">{flow.pdfs.length ? `${flow.pdfs.length} ${flow.pdfs.length === 1 ? "PDF" : "PDFs"}` : "No PDFs yet"}</p>
				<span className="ms-auto" />
				<Popover placement="bottom-end">
					<PopoverTrigger>
						<Button size="sm" startContent={<HugeiconsIcon aria-hidden icon={CheckListIcon} size={15} />} variant="muted">
							{flow.checks.length + FILE_CHECKS.length} checks
						</Button>
					</PopoverTrigger>
					<PopoverContent className="w-[24rem] p-4">
						<div className="max-h-[32rem] w-full overflow-y-auto">
							<ChecksEditor busy={flow.busy} criteria={flow.checks} fileNote={false} onChange={flow.setChecks} />
							<p className="mb-1 mt-4 text-xs text-black/45 dark:text-white/45">From the file itself, for every PDF</p>
							<FileChecksList />
						</div>
					</PopoverContent>
				</Popover>
				{flow.pdfs.length ? (
					<Button isDisabled={flow.busy} onPress={() => flow.setPdfs([])} size="sm" variant="transparent">
						Clear all
					</Button>
				) : null}
			</div>
			{flow.pdfs.length ? (
				<div className="overflow-hidden rounded-xl border border-black/[0.06] dark:border-white/[0.06]" role="table">
					<div className="grid" role="row" style={columns}>
						<span className={header} role="columnheader" />
						<span className={header} role="columnheader">
							File
						</span>
						<span className={`${header} justify-end`} role="columnheader">
							Pages
						</span>
						<span className={`${header} justify-end`} role="columnheader">
							Size
						</span>
						<span className={`${header} justify-end`} role="columnheader">
							To read
						</span>
						<span className={header} role="columnheader" />
					</div>
					{items.map((file) => (
						<div className="grid h-12 hover:bg-black/[0.025] dark:hover:bg-white/[0.03]" key={`${file.name}:${file.size}`} role="row" style={columns}>
							<span className={cell} role="cell">
								<ImportCover className="w-6" file={file} size={11} />
							</span>
							<span className={`${cell} text-sm text-black/80 dark:text-white/80`} role="cell">
								<TruncatedText text={file.name} />
							</span>
							<span className={`${cell} justify-end`} role="cell">
								<PageCount file={file} />
							</span>
							<span className={`${cell} justify-end text-xs tabular-nums text-black/50 dark:text-white/50`} role="cell">
								{megabytes(file.size)}
							</span>
							<span className={`${cell} justify-end text-xs tabular-nums text-black/50 dark:text-white/50`} role="cell">
								<Suspense fallback={null}>
									<FileCost file={file} />
								</Suspense>
							</span>
							<span className={`${cell} justify-center px-0`} role="cell">
								<RemoveButton busy={flow.busy} name={file.name} onPress={() => flow.setPdfs(flow.pdfs.filter((other) => other !== file))} />
							</span>
						</div>
					))}
					<DropArea accept={PDF_ACCEPT} busy={flow.busy} className="h-12 !flex-row gap-2 rounded-none border-0" label="Add more PDFs" onFiles={add}>
						<HugeiconsIcon aria-hidden className="text-black/40 dark:text-white/40" icon={Upload04Icon} size={15} />
						<span className="text-sm text-black/60 dark:text-white/60">
							Add more, or <span className="font-medium text-accent">browse</span>
						</span>
					</DropArea>
				</div>
			) : (
				<DropArea accept={PDF_ACCEPT} busy={flow.busy} className="min-h-[30rem]" label="PDFs" onFiles={add}>
					<DropText hint={`Up to ${PDF_IMPORT_MAX_FILES} PDFs, 50 MB each. Claude Haiku 5.5 reads each one.`} what="PDFs" />
				</DropArea>
			)}
			<ImportPager label="Pages of chosen PDFs" onChange={setPage} page={current} pages={pages} perPage={ROWS_PER_PAGE} total={flow.pdfs.length} />
		</div>
	);
}

type SortColumn = "checks" | "title" | "year";

function sorted(rows: ImportRow[], flow: ImportFlowState, sort: SortColumn, direction: "asc" | "desc") {
	const key = (row: ImportRow): number | string => (sort === "title" ? (row.record?.title ?? row.file?.name ?? "").toLowerCase() : sort === "year" ? (row.record?.year ?? 0) : flow.checksOf(row).filter(checkPasses).length);
	const order = direction === "asc" ? 1 : -1;
	return [...rows].sort((a, b) => (key(a) < key(b) ? -order : key(a) > key(b) ? order : 0));
}

const markLook = {
	added: { icon: PlusSignIcon, tone: "text-emerald-700 dark:text-emerald-400" },
	changed: { icon: PencilEdit02Icon, tone: "text-amber-700 dark:text-amber-400" },
	removed: { icon: MinusSignIcon, tone: "text-black/50 dark:text-white/50" },
} as const;

/** What publishing does to the file's properties, as counts of each mark. */
function PropertyMarks({ flow, row }: { flow: ImportFlowState; row: ImportRow }) {
	if (!row.pdf || !row.record) return null;
	if (!row.pdf.writable) {
		return (
			<span className="flex items-center gap-1 text-xs text-black/45 dark:text-white/45">
				<HugeiconsIcon aria-hidden icon={LockIcon} size={12} />
				Can&apos;t write
			</span>
		);
	}
	const properties = flow.propertiesOf(row);
	const now = row.pdf.properties;
	const changes = PROPERTY_ROWS.map(({ field }) => changeOf(field, properties, now));
	return (
		<span className="flex items-center gap-2.5 text-xs tabular-nums">
			{(["added", "changed", "removed"] as const).map((mark) => {
				const count = changes.filter((change) => change === mark).length;
				return count ? (
					<span aria-label={`${count} ${mark}`} className={`flex items-center gap-0.5 ${markLook[mark].tone}`} key={mark}>
						<HugeiconsIcon aria-hidden icon={markLook[mark].icon} size={11} />
						{count}
					</span>
				) : null;
			})}
		</span>
	);
}

/** The review as a sheet: a row per record, a column per check, the full record in a panel. */
function RecordSheet({ flow }: { flow: ImportFlowState }) {
	const batch = flow.batch!;
	const reduceMotion = useReducedMotion();
	const [page, setPage] = useState(1);
	const [sort, setSort] = useState<{ column: SortColumn; direction: "asc" | "desc" }>({ column: "title", direction: "asc" });
	const [openId, setOpenId] = useState<string | null>(null);
	const pdfs = batch.kind === "pdfs";
	const criteria = pdfs ? [...batch.checks, ...FILE_CHECKS.map(({ criterion }) => criterion)] : [];
	const rows = sorted(flow.shown, flow, sort.column, sort.direction);
	const { current, items, pages } = pageOf(rows, page, ROWS_PER_PAGE);
	const open = batch.rows.find(({ id }) => id === openId) ?? null;
	const all = flow.readyIds.length > 0 && flow.readyIds.every((id) => flow.selected.has(id));
	const fixable = batch.rows.filter((row) => flow.selected.has(row.id) && row.rightsFix && !row.fixApplied);
	const onSort = (column: SortColumn) => setSort((value) => ({ column, direction: value.column === column && value.direction === "asc" ? "desc" : "asc" }));
	const columns: CSSProperties = { gridTemplateColumns: `3rem minmax(19rem,1fr) 5rem ${criteria.map(() => "5.5rem").join(" ")} ${pdfs ? "5.5rem 6.5rem 7.5rem" : "10rem"} 3.5rem` };
	// The record column takes what the others leave, down to 19rem; below that the sheet scrolls sideways.
	const minWidth = `${3 + 19 + 5 + criteria.length * 5.5 + (pdfs ? 19.5 : 10) + 3.5}rem`;
	const head = header.replace("h-9", "h-12 leading-4");
	const choose = (id: string, checked: boolean) => {
		const next = new Set(flow.selected);
		if (checked) next.add(id);
		else next.delete(id);
		flow.setSelected(next);
	};
	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<div className="flex h-14 shrink-0 items-center gap-4 px-8">
				<div className="min-w-0 flex-1">
					<ReviewBar costUsd={flow.costUsd} counts={flow.counts} filter={flow.filter} kind={batch.kind} onFilter={flow.setFilter} />
				</div>
				{fixable.length ? (
					<Button onPress={() => fixable.forEach((row) => flow.setFix(row.id, true))} size="sm" startContent={<HugeiconsIcon aria-hidden icon={Tick02Icon} size={14} />} variant="muted">
						Apply suggested Rights to {fixable.length}
					</Button>
				) : null}
			</div>
			<div className="min-h-0 flex-1 overflow-auto border-t border-black/[0.06] dark:border-white/[0.06]">
				<div role="table" style={{ minWidth }}>
					<div className="sticky top-0 z-10 grid" role="row" style={columns}>
						<span className={`${head} sticky left-0 z-10 justify-center`} role="columnheader">
							<Checkbox aria-label="Choose every ready record" isDisabled={flow.locked || !flow.readyIds.length} isIndeterminate={flow.selected.size > 0 && !all} isSelected={all} onValueChange={(checked) => flow.setSelected(new Set(checked ? flow.readyIds : []))} size="sm" />
						</span>
						<span className={`${head} sticky left-12 z-10`} role="columnheader">
							<SortHeader columnId="title" label="Record" onSort={onSort} sort={sort.column} sortDirection={sort.direction} tabIndex={0} />
						</span>
						<span className={head} role="columnheader">
							<SortHeader columnId="year" label="Year" onSort={onSort} sort={sort.column} sortDirection={sort.direction} tabIndex={0} />
						</span>
						{criteria.map((criterion) => (
							<span className={head} key={criterion} role="columnheader">
								<TruncatedText lines={2} text={criterion} />
							</span>
						))}
						{pdfs ? (
							<>
								<span className={head} role="columnheader">
									Topics
								</span>
								<span className={head} role="columnheader">
									Rights fix
								</span>
								<span className={head} role="columnheader">
									PDF properties
								</span>
							</>
						) : (
							<span className={head} role="columnheader">
								<SortHeader columnId="checks" label="State" onSort={onSort} sort={sort.column} sortDirection={sort.direction} tabIndex={0} />
							</span>
						)}
						<span className={head} role="columnheader" />
					</div>
					{items.map((row) => {
						const title = row.record?.title ?? row.file?.name ?? row.record?.source ?? "";
						const checks = flow.checksOf(row);
						const read = row.state === "read" || row.state === "failed";
						const status = rowStatus(row, flow.resultById.get(row.id), batch.attach.get(row.id));
						const active = row.id === openId;
						return (
							<div className={`group grid h-14 transition-colors ${active ? "bg-black/[0.045] dark:bg-white/[0.06]" : "hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"}`} key={row.id} role="row" style={columns}>
								<span className={`${cell} sticky left-0 justify-center bg-background_light group-hover:bg-transparent dark:bg-card`} role="cell">
									<Checkbox aria-label={`Import ${title}`} isDisabled={flow.locked || row.record?.state !== "ready"} isSelected={flow.selected.has(row.id)} onValueChange={(checked) => choose(row.id, checked)} size="sm" />
								</span>
								<span className={`${cell} sticky left-12 gap-3 bg-background_light dark:bg-card`} role="cell">
									<ImportCover className="w-7" file={row.file} itemType={row.record?.itemType} reading={row.state === "reading"} size={11} />
									<button className="flex min-w-0 flex-1 flex-col items-start rounded text-start outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => setOpenId(row.id)} type="button">
										<span className={`w-full truncate text-sm ${row.record?.title ? "font-medium text-black/85 dark:text-white/85" : "text-black/45 dark:text-white/45"}`}>{title}</span>
										{status.label === "Ready" && row.record ? <span className="w-full truncate text-xs text-black/50 dark:text-white/50">{creatorsLine(row.record.creators) || "No authors"}</span> : <StatusText status={status} />}
									</button>
								</span>
								<span className={`${cell} text-xs tabular-nums text-black/60 dark:text-white/60`} role="cell">
									{row.record?.year ?? ""}
								</span>
								{criteria.map((criterion, index) => {
									const check = checks[index];
									const look = check ? lookOf(check) : null;
									return (
										<span className={cell} key={criterion} role="cell">
											{look ? <HugeiconsIcon aria-label={`${look.label}: ${criterion}`} className={look.tone} icon={look.icon} size={16} /> : <span className={`h-1.5 w-6 rounded-full bg-black/[0.07] dark:bg-white/[0.08] ${read ? "" : "animate-pulse"}`} />}
										</span>
									);
								})}
								{pdfs ? (
									<>
										<span className={`${cell} text-xs tabular-nums text-black/60 dark:text-white/60`} role="cell">
											{row.topics.length ? `${flow.topicsOf(row).size} of ${row.topics.length}` : ""}
										</span>
										<span className={cell} role="cell">
											{row.rightsFix ? (
												<Button className="h-7 min-h-7 min-w-[4.5rem]" isDisabled={flow.locked} onPress={() => flow.toggleFix(row.id)} size="xs" startContent={<HugeiconsIcon aria-hidden icon={row.fixApplied ? Undo02Icon : Tick02Icon} size={12} />} variant={row.fixApplied ? "transparent" : "muted"}>
													{row.fixApplied ? "Undo" : "Apply"}
												</Button>
											) : read ? (
												<span className="text-xs text-black/40 dark:text-white/40">None needed</span>
											) : null}
										</span>
										<span className={cell} role="cell">
											<PropertyMarks flow={flow} row={row} />
										</span>
									</>
								) : (
									<span className={cell} role="cell">
										<StatusText status={status} />
									</span>
								)}
								<span className={`${cell} justify-center px-0`} role="cell">
									<Button aria-label={`Open ${title}`} className="size-8 min-w-8" isIconOnly onPress={() => setOpenId(row.id)} size="xs" variant="transparent">
										<HugeiconsIcon aria-hidden icon={ArrowRight01Icon} size={15} />
									</Button>
								</span>
							</div>
						);
					})}
				</div>
				{!items.length ? <p className="flex h-28 items-center justify-center text-sm text-black/45 dark:text-white/45">Nothing here</p> : null}
			</div>
			<div className="shrink-0 border-t border-black/[0.06] px-8 pb-3 dark:border-white/[0.06]">
				<ImportPager label="Pages of records" onChange={setPage} page={current} pages={pages} perPage={ROWS_PER_PAGE} total={rows.length} />
				{pages < 2 ? <p className="pt-3 text-xs tabular-nums text-black/50 dark:text-white/50">{rows.length} {rows.length === 1 ? "record" : "records"}</p> : null}
			</div>
			<AnimatePresence>
				{open ? (
					<motion.aside
						animate={{ x: 0 }}
						className="absolute inset-y-0 end-0 z-20 flex w-[34rem] flex-col border-s border-black/10 bg-background_light shadow-[-12px_0_32px_-16px_rgba(0,0,0,0.25)] dark:border-white/10 dark:bg-card"
						exit={{ x: "100%" }}
						initial={{ x: "100%" }}
						key="record"
						transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.32, 0.72, 0, 1] }}
					>
						<div className="flex h-12 shrink-0 items-center gap-2 border-b border-black/[0.06] px-4 dark:border-white/[0.06]">
							<span className="text-sm font-medium text-black/70 dark:text-white/70">Record</span>
							<Button aria-label="Close the record" className="ms-auto size-8 min-w-8" isIconOnly onPress={() => setOpenId(null)} size="xs" variant="transparent">
								<HugeiconsIcon aria-hidden icon={Cancel01Icon} size={15} />
							</Button>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
					</motion.aside>
				) : null}
			</AnimatePresence>
		</div>
	);
}

/** The new drafts as a sheet: tick the ones to publish, see each one's checks and DOI. */
function DraftSheet({ flow }: { flow: ImportFlowState }) {
	const [page, setPage] = useState(1);
	const view = publishView(flow.batch!, flow.choosePublish);
	const { current, items, pages } = pageOf(view.drafts, page, ROWS_PER_PAGE);
	const columns: CSSProperties = { gridTemplateColumns: "3rem minmax(22rem,1fr) 9rem 14rem 7rem" };
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-14 shrink-0 items-center gap-6 px-8">
				<h3 className="text-base font-semibold tabular-nums text-black/90 dark:text-white/90">{view.headline}</h3>
				{view.tally.map((line) => (
					<span className={`text-sm tabular-nums text-black/55 dark:text-white/55 ${line.tone}`} key={line.label}>
						<span className="font-medium">{line.count}</span> {inSentence(line.label)}
					</span>
				))}
			</div>
			<div className="min-h-0 flex-1 overflow-auto border-t border-black/[0.06] dark:border-white/[0.06]" role="table">
				<div className="sticky top-0 z-10 grid" role="row" style={columns}>
					<span className={`${header} justify-center`} role="columnheader">
						{view.publishable.length ? <Checkbox aria-label="Choose every draft to publish" isDisabled={view.started} isIndeterminate={view.chosen.size > 0 && !view.all} isSelected={view.all} onValueChange={view.toggleAll} size="sm" /> : null}
					</span>
					<span className={header} role="columnheader">
						Draft
					</span>
					<span className={header} role="columnheader">
						Checks
					</span>
					<span className={header} role="columnheader">
						Publishing
					</span>
					<span className={header} role="columnheader" />
				</div>
				{items.map(({ itemKey, row }) => (
					<div className="grid h-14 hover:bg-black/[0.025] dark:hover:bg-white/[0.03]" key={row.id} role="row" style={columns}>
						<span className={`${cell} justify-center`} role="cell">
							{view.publishable.length ? <Checkbox aria-label={`Publish ${row.record?.title ?? row.record?.source}`} isDisabled={view.started || !row.file} isSelected={view.chosen.has(row.id)} onValueChange={(checked) => view.toggle(row.id, checked)} size="sm" /> : null}
						</span>
						<span className={`${cell} gap-3`} role="cell">
							<ImportCover className="w-7" file={row.file} itemType={row.record?.itemType} size={11} />
							<span className="min-w-0 truncate text-sm font-medium text-black/85 dark:text-white/85">{row.record?.title ?? row.record?.source}</span>
						</span>
						<span className={cell} role="cell">
							<CheckMeter checks={flow.checksOf(row)} count={row.file ? flow.checkCount : 0} />
						</span>
						<span className={cell} role="cell">
							<DraftState publish={flow.batch!.publish.get(row.id)} row={row} />
						</span>
						<span className={`${cell} justify-end`} role="cell">
							<Button onPress={() => flow.onOpenRecord(itemKey)} size="xs" variant="transparent">
								Open draft
							</Button>
						</span>
					</div>
				))}
			</div>
			<div className="shrink-0 border-t border-black/[0.06] px-8 pb-3 dark:border-white/[0.06]">
				<ImportPager label="Pages of new drafts" onChange={setPage} page={current} pages={pages} perPage={ROWS_PER_PAGE} total={view.drafts.length} />
			</div>
		</div>
	);
}
