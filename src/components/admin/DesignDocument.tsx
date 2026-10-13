"use client";

import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, ArrowRight02Icon, FileExportIcon, SquareArrowUpRight02Icon } from "@hugeicons/core-free-icons";
import Image from "next/image";
import { Suspense, use, useDeferredValue, useState, type ReactNode } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";
import { TruncatedText } from "@/components/nextui/TruncatedText";

import { DraftState, publishView } from "./ImportDone";
import { BibliographyInput, ChecksEditor, DoiInput, DropArea, DropText, megabytes, PDF_ACCEPT, RemoveButton, SectionLabel, withNew } from "./ImportInputs";
import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import {
	Abstract,
	CheckMeter,
	Checks,
	DetailSection,
	MetadataLine,
	openWithProperties,
	PdfPropertiesList,
	propertiesAside,
	ReadingPlaceholder,
	ReviewBar,
	RightsFixLine,
	rowStatus,
	StatusText,
	TopicList,
} from "./ImportReview";
import { humanizeAdminField } from "./admin-schema";
import { checkPasses, PDF_IMPORT_MAX_FILES, type ImportRow } from "./admin-import";
import { DesignHeader, FileChecksList, InputNote, NarrowPager, PageCount, SourceTabs, StageFade } from "./import-design-parts";
import { action, CollectionsButton, type ImportFlowState } from "./import-flow";
import { pdfPage, pdfPageCount, pdfThumbnail } from "./pdf-thumbnail";

const SHELF_PER_PAGE = 11;
const STRIP_PER_PAGE = 3;
const WALL_PER_PAGE = 10;

/**
 * Design 1, the PDF beside its record: the review shows the document itself
 * between a filmstrip of covers and the record the AI read from it, and a
 * check's page number turns the viewer to that page.
 */
export function DesignDocument({ flow }: { flow: ImportFlowState }) {
	const { stage } = flow;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<DesignHeader stage={stage} />
			<StageFade stage={stage}>
				{stage === "input" ? <DocumentInput flow={flow} /> : null}
				{stage === "review" && flow.batch ? <DocumentReview flow={flow} /> : null}
				{stage === "done" && flow.batch?.results ? <CoverWall flow={flow} /> : null}
			</StageFade>
			<DocumentFooter flow={flow} />
		</div>
	);
}

function DocumentFooter({ flow }: { flow: ImportFlowState }) {
	const { batch, stage } = flow;
	const view = stage === "done" && batch ? publishView(batch, flow.choosePublish) : null;
	return (
		<footer className="flex h-16 shrink-0 items-center gap-3 border-t border-black/[0.06] px-6 dark:border-white/[0.06]">
			{stage === "input" || flow.error ? <InputNote flow={flow} /> : null}
			{stage === "review" && !flow.error ? (
				<>
					<CollectionsButton collections={batch?.collections ?? []} locked={flow.locked} onChange={flow.setCollections} sources={flow.sources} />
					{flow.reading ? <p className="text-xs text-black/50 dark:text-white/50">Reading carries on if you close this</p> : null}
				</>
			) : null}
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
						{view.publishable.length ? (
							<Button className="min-w-20" onPress={flow.finish} size="sm" variant="muted">
								Done
							</Button>
						) : (
							<Button className="min-w-20" color="accent" onPress={flow.finish} size="sm" variant="solid">
								Done
							</Button>
						)}
						{view.publishable.length ? (
							<Button className="min-w-44" color="accent" isDisabled={view.started || !view.chosen.size} onPress={() => flow.publish([...view.chosen])} size="sm" variant="solid">
								{view.publishLabel}
							</Button>
						) : null}
					</>
				) : null}
			</span>
		</footer>
	);
}

function DocumentInput({ flow }: { flow: ImportFlowState }) {
	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
			<SourceTabs
				dois={<DoiInput busy={flow.busy} onChange={flow.setDoiText} text={flow.doiText} />}
				files={<BibliographyInput busy={flow.busy} files={flow.files} onFilesChange={flow.setFiles} />}
				flow={flow}
				pdfs={
					<div className="grid min-h-full grid-cols-[minmax(0,1fr)_20rem] gap-10">
						<CoverShelf busy={flow.busy} files={flow.pdfs} onFilesChange={flow.setPdfs} />
						<div className="border-s border-black/[0.06] ps-8 dark:border-white/[0.06]">
							<ChecksEditor busy={flow.busy} criteria={flow.checks} fileNote={false} onChange={flow.setChecks} />
							<p className="mb-1 mt-5 text-xs text-black/45 dark:text-white/45">From the file itself, for every PDF</p>
							<FileChecksList />
						</div>
					</div>
				}
			/>
		</div>
	);
}

/** The chosen PDFs as a shelf of covers with their pages, and a tile that adds more. */
function CoverShelf({ busy, files, onFilesChange }: { busy: boolean; files: File[]; onFilesChange: (files: File[]) => void }) {
	const [page, setPage] = useState(1);
	const { current, items, pages } = pageOf(files, page, SHELF_PER_PAGE);
	const add = (chosen: File[]) => onFilesChange(withNew(files, chosen));
	if (!files.length) {
		return (
			<DropArea accept={PDF_ACCEPT} busy={busy} className="min-h-[34rem]" label="PDFs" onFiles={add}>
				<DropText hint={`Up to ${PDF_IMPORT_MAX_FILES} PDFs, 50 MB each. Claude Haiku 5.5 reads each one.`} what="PDFs" />
			</DropArea>
		);
	}
	return (
		<div>
			<SectionLabel
				aside={
					<span className="flex items-center gap-3">
						{megabytes(files.reduce((sum, file) => sum + file.size, 0))}
						<button className="font-medium text-black/60 hover:text-black/85 disabled:opacity-50 dark:text-white/60 dark:hover:text-white/85" disabled={busy} onClick={() => onFilesChange([])} type="button">
							Clear all
						</button>
					</span>
				}
			>
				{files.length} {files.length === 1 ? "PDF" : "PDFs"}
			</SectionLabel>
			<ul className="grid grid-cols-6 gap-x-4 gap-y-5">
				{items.map((file) => (
					<li className="group/cover relative min-w-0" key={`${file.name}:${file.size}`}>
						<ImportCover className="w-full" file={file} size={20} />
						<span className="absolute end-1 top-1 rounded-md bg-white opacity-0 shadow-sm transition-opacity duration-150 focus-within:opacity-100 group-hover/cover:opacity-100 dark:bg-black/70">
							<RemoveButton busy={busy} name={file.name} onPress={() => onFilesChange(files.filter((other) => other !== file))} />
						</span>
						<span className="mt-2 block text-xs text-black/75 dark:text-white/75">
							<TruncatedText text={file.name} />
						</span>
						<PageCount file={file} />
					</li>
				))}
				<li>
					<DropArea accept={PDF_ACCEPT} busy={busy} className="aspect-[3/4] w-full gap-1.5" label="Add more PDFs" onFiles={add}>
						<HugeiconsIcon aria-hidden className="text-black/40 dark:text-white/40" icon={Add01Icon} size={18} />
						<span className="text-xs text-black/60 dark:text-white/60">Add PDFs</span>
					</DropArea>
				</li>
			</ul>
			<ImportPager label="Pages of chosen PDFs" onChange={setPage} page={current} pages={pages} perPage={SHELF_PER_PAGE} total={files.length} />
		</div>
	);
}

function DocumentReview({ flow }: { flow: ImportFlowState }) {
	const { activeRow, batch } = flow;
	const [viewer, setViewer] = useState<{ id: string; page: number } | null>(null);
	if (!batch) return null;
	const page = viewer && viewer.id === activeRow?.id ? viewer.page : 1;
	const turnTo = (next: number) => activeRow && setViewer({ id: activeRow.id, page: next });
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="shrink-0 px-6 py-3">
				<ReviewBar costUsd={flow.costUsd} counts={flow.counts} filter={flow.filter} kind={batch.kind} onFilter={flow.setFilter} />
			</div>
			<div className={`grid min-h-0 flex-1 border-t border-black/[0.06] dark:border-white/[0.06] ${activeRow?.file ? "grid-cols-[11.5rem_minmax(0,1fr)_29rem]" : "grid-cols-[11.5rem_minmax(0,1fr)]"}`}>
				<Filmstrip flow={flow} />
				{activeRow?.file ? <PdfViewer file={activeRow.file} key={activeRow.id} onPage={turnTo} page={page} /> : null}
				<div className="min-h-0 overflow-y-auto border-s border-black/[0.06] px-6 py-5 dark:border-white/[0.06]">{activeRow ? <RecordPanel flow={flow} key={activeRow.id} onPage={activeRow.file ? turnTo : undefined} row={activeRow} /> : null}</div>
			</div>
		</div>
	);
}

/** The records as a column of covers: tick to import, press to look. */
function Filmstrip({ flow }: { flow: ImportFlowState }) {
	const [page, setPage] = useState(1);
	const { current, items, pages } = pageOf(flow.shown, page, STRIP_PER_PAGE);
	const all = flow.readyIds.length > 0 && flow.readyIds.every((id) => flow.selected.has(id));
	return (
		<div className="flex min-h-0 flex-col">
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-black/[0.06] px-3 dark:border-white/[0.06]">
				<Checkbox
					aria-label="Choose every ready record"
					isDisabled={flow.locked || !flow.readyIds.length}
					isIndeterminate={flow.selected.size > 0 && !all}
					isSelected={all}
					onValueChange={(checked) => flow.setSelected(new Set(checked ? flow.readyIds : []))}
					size="sm"
				/>
				<span className="text-xs tabular-nums text-black/50 dark:text-white/50">
					{flow.selected.size} of {flow.readyIds.length} chosen
				</span>
			</div>
			<ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
				{items.map((row) => {
					const active = row.id === flow.activeRow?.id;
					const title = row.record?.title ?? row.file?.name ?? row.record?.source ?? "";
					return (
						<li className={`relative rounded-lg p-2.5 transition-colors duration-150 ${active ? "bg-black/[0.055] dark:bg-white/[0.08]" : "hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"}`} key={row.id}>
							<button aria-current={active || undefined} className="flex w-full flex-col items-center gap-2 rounded-md text-center outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => flow.setActiveId(row.id)} type="button">
								<ImportCover className={`w-[5.5rem] ${active ? "!ring-2 !ring-accent" : ""}`} file={row.file} itemType={row.record?.itemType} reading={row.state === "reading"} size={16} />
								<span className={`line-clamp-2 w-full text-xs leading-4 ${row.record?.title ? "text-black/80 dark:text-white/80" : "text-black/45 dark:text-white/45"}`}>{title}</span>
							</button>
							<span className="mt-1.5 flex justify-center">
								<CheckMeter checks={flow.checksOf(row)} count={row.file ? flow.checkCount : 0} />
							</span>
							<span className="absolute start-2 top-2">
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
						</li>
					);
				})}
				{!items.length ? <li className="flex h-28 items-center justify-center text-sm text-black/45 dark:text-white/45">Nothing here</li> : null}
			</ul>
			<div className="shrink-0 border-t border-black/[0.06] px-3 pb-2 dark:border-white/[0.06]">
				<NarrowPager onChange={setPage} page={current} pages={pages} perPage={STRIP_PER_PAGE} total={flow.shown.length} />
			</div>
		</div>
	);
}

function PageTotal({ file, onPage, page }: { file: File; onPage: (page: number) => void; page: number }) {
	const total = use(pdfPageCount(file)) ?? 1;
	return (
		<>
			<Button aria-label="Previous page" className="size-7 min-w-7" isDisabled={page <= 1} isIconOnly onPress={() => onPage(page - 1)} size="xs" variant="transparent">
				<HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} size={14} />
			</Button>
			<span className="min-w-24 text-center text-xs tabular-nums text-black/60 dark:text-white/60">
				Page {Math.min(page, total)} of {total}
			</span>
			<Button aria-label="Next page" className="size-7 min-w-7" isDisabled={page >= total} isIconOnly onPress={() => onPage(page + 1)} size="xs" variant="transparent">
				<HugeiconsIcon aria-hidden icon={ArrowRight01Icon} size={14} />
			</Button>
		</>
	);
}

/** The PDF a page at a time. The page box holds an A4 shape, so turning pages never moves the layout. */
function PdfViewer({ file, onPage, page }: { file: File; onPage: (page: number) => void; page: number }) {
	const shown = useDeferredValue(page);
	return (
		<div className="flex min-h-0 flex-col bg-black/[0.03] dark:bg-white/[0.02]">
			<div className="flex h-10 shrink-0 items-center gap-1 border-b border-black/[0.06] px-3 dark:border-white/[0.06]">
				<Suspense fallback={<span className="h-7" />}>
					<PageTotal file={file} onPage={onPage} page={page} />
				</Suspense>
				<Button className="ms-auto" onPress={() => window.open(URL.createObjectURL(file), "_blank", "noopener")} size="xs" startContent={<HugeiconsIcon aria-hidden icon={SquareArrowUpRight02Icon} size={13} />} variant="transparent">
					Open PDF
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-6">
				<div className="relative mx-auto aspect-[1/1.414] w-full max-w-[44rem] overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-black/10 dark:ring-white/10">
					<Suspense fallback={<Thumbnail file={file} />}>
						<PageImage file={file} page={shown} stale={shown !== page} />
					</Suspense>
				</div>
			</div>
		</div>
	);
}

function Thumbnail({ file }: { file: File }) {
	return (
		<Suspense fallback={null}>
			<ThumbnailImage file={file} />
		</Suspense>
	);
}

function ThumbnailImage({ file }: { file: File }) {
	const url = use(pdfThumbnail(file));
	return url ? <Image alt="" className="object-contain blur-[1px]" fill sizes="44rem" src={url} unoptimized /> : null;
}

function PageImage({ file, page, stale }: { file: File; page: number; stale: boolean }) {
	const image = use(pdfPage(file, page));
	if (!image) return <p className="absolute inset-0 flex items-center justify-center text-sm text-black/45">This page can&apos;t be shown</p>;
	return <Image alt={`Page ${page}`} className={`animate-fade-in object-contain transition-opacity duration-200 [animation-duration:250ms] ${stale ? "opacity-60" : ""}`} fill key={page} sizes="44rem" src={image.url} unoptimized />;
}

/** The record the AI read, beside the PDF: what it found, its checks and what publishing writes into the file. */
function RecordPanel({ flow, onPage, row }: { flow: ImportFlowState; onPage?: (page: number) => void; row: ImportRow }) {
	const record = row.record;
	const payload = record?.payload ?? {};
	const abstract = typeof payload.abstractNote === "string" ? payload.abstractNote : null;
	const settled = row.state === "read" || row.state === "failed";
	const checks = flow.checksOf(row);
	const result = flow.resultById.get(row.id);
	const openKey = result?.itemKey ?? record?.existingKey;
	const properties = flow.propertiesOf(row);
	const kindLine = [record?.itemType ? humanizeAdminField(record.itemType) : null, record?.year].filter(Boolean);
	return (
		<article className="flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<p className="flex h-4 gap-3 text-xs text-black/45 dark:text-white/45">
					{kindLine.map((part) => (
						<span key={String(part)}>{part}</span>
					))}
				</p>
				<h3 className={`text-lg font-semibold leading-6 ${record?.title ? "text-black/90 dark:text-white/90" : "text-black/40 dark:text-white/40"}`}>{record?.title ?? row.file?.name ?? record?.source}</h3>
				{record?.creators.length ? <p className="text-sm text-black/60 dark:text-white/60">{record.creators.join(", ")}</p> : null}
				<div className="mt-1">
					<StatusText status={rowStatus(row, result, flow.batch?.attach.get(row.id))} />
				</div>
				{row.message ? <p className="text-xs text-danger">{row.message}</p> : null}
			</header>
			{!settled ? (
				<ReadingPlaceholder />
			) : (
				<div className="flex animate-fade-in flex-col gap-6 [animation-duration:300ms]">
					{record ? <MetadataLine payload={payload} /> : null}
					{abstract ? (
						<DetailSection aside={row.abstractWritten ? "Written by AI, the PDF has none" : undefined} title="Abstract">
							<Abstract text={abstract} />
						</DetailSection>
					) : null}
					{row.file && flow.checkCount ? (
						<DetailSection aside={`${checks.filter(checkPasses).length} of ${flow.checkCount} pass`} title="Checks">
							<Checks checks={checks} onPage={onPage}>
								{row.rightsFix ? <RightsFixLine applied={row.fixApplied} fix={row.rightsFix} locked={flow.locked} onToggle={() => flow.toggleFix(row.id)} stated={typeof payload.rights === "string" ? payload.rights : ""} /> : null}
							</Checks>
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
				</div>
			)}
			<PanelActions>
				{row.file && record && row.pdf?.writable ? (
					<Button onPress={() => void openWithProperties(row.file!, properties)} size="xs" startContent={<HugeiconsIcon aria-hidden icon={FileExportIcon} size={14} />} variant="muted">
						Open with new properties
					</Button>
				) : null}
				{openKey ? (
					<Button onPress={() => flow.onOpenRecord(openKey)} size="xs" startContent={<HugeiconsIcon aria-hidden icon={ArrowRight02Icon} size={14} />} variant="muted">
						{result?.itemKey ? "Open the draft" : "Open the record"}
					</Button>
				) : null}
			</PanelActions>
		</article>
	);
}

function PanelActions({ children }: { children: ReactNode }) {
	return <div className="flex flex-wrap gap-2 empty:hidden">{children}</div>;
}

/** The new drafts as covers: tick the ones to publish with a DOI, open any of them. */
function CoverWall({ flow }: { flow: ImportFlowState }) {
	const [page, setPage] = useState(1);
	const view = publishView(flow.batch!, flow.choosePublish);
	const { current, items, pages } = pageOf(view.drafts, page, WALL_PER_PAGE);
	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
			<div className="flex items-end gap-6">
				<div>
					<h3 className="text-xl font-semibold tabular-nums text-black/90 dark:text-white/90">{view.headline}</h3>
					<p className="mt-1 text-sm text-black/55 dark:text-white/55">
						{view.started ? "Each published record gets its DOI from the Zenodo sandbox." : view.publishable.length ? `${view.passing} of ${view.publishable.length} pass every check and start ticked. Tick the ones to publish now.` : "They stay in Drafts until someone publishes them."}
					</p>
				</div>
				{view.tally.length ? (
					<dl className="ms-auto flex gap-6">
						{view.tally.map((line) => (
							<div className="text-end" key={line.label}>
								<dd className={`text-lg font-semibold tabular-nums text-black/85 dark:text-white/85 ${line.tone}`}>{line.count}</dd>
								<dt className="text-xs text-black/50 dark:text-white/50">{line.label}</dt>
							</div>
						))}
					</dl>
				) : null}
			</div>
			{view.publishable.length ? (
				<div className="mt-6 flex h-9 items-center gap-3 border-b border-black/[0.06] dark:border-white/[0.06]">
					<Checkbox aria-label="Choose every draft to publish" isDisabled={view.started} isIndeterminate={view.chosen.size > 0 && !view.all} isSelected={view.all} onValueChange={view.toggleAll} size="sm" />
					<span className="text-xs tabular-nums text-black/50 dark:text-white/50">
						{view.chosen.size} of {view.publishable.length} to publish
					</span>
				</div>
			) : null}
			<ul className="mt-5 grid grid-cols-7 gap-x-5 gap-y-7">
				{items.map(({ itemKey, row }) => {
					const chosen = view.chosen.has(row.id);
					return (
						<li className="min-w-0" key={row.id}>
							<ImportCover className={`w-full transition-shadow duration-150 ${chosen ? "!ring-2 !ring-accent" : ""}`} file={row.file} itemType={row.record?.itemType} size={22} />
							<div className="mt-2.5 flex gap-2">
								{view.publishable.length ? (
									<span className="pt-0.5">
										<Checkbox aria-label={`Publish ${row.record?.title ?? row.record?.source}`} isDisabled={view.started || !row.file} isSelected={chosen} onValueChange={(checked) => view.toggle(row.id, checked)} size="sm" />
									</span>
								) : null}
								<button className="line-clamp-2 text-start text-sm font-medium leading-5 text-black/85 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent dark:text-white/85" onClick={() => flow.onOpenRecord(itemKey)} type="button">
									{row.record?.title ?? row.record?.source}
								</button>
							</div>
							<span className={`mt-1 flex h-5 items-center ${view.publishable.length ? "ps-7" : ""}`}>
								<DraftState publish={flow.batch!.publish.get(row.id)} row={row} />
							</span>
						</li>
					);
				})}
			</ul>
			<ImportPager label="Pages of new drafts" onChange={setPage} page={current} pages={pages} perPage={WALL_PER_PAGE} total={view.drafts.length} />
		</div>
	);
}
