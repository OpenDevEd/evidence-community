"use client";

import { ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, FileExportIcon, SquareArrowUpRight02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { useEffect, useState } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";

import { ImportDone } from "./ImportDone";
import { BibliographyInput, ChecksEditor, DoiInput, DropArea, DropText, PDF_ACCEPT, withNew } from "./ImportInputs";
import { ImportCover } from "./ImportCover";
import { Abstract, Checks, DetailSection, MetadataLine, openWithProperties, PdfPropertiesList, propertiesAside, ReadingPlaceholder, RightsFixLine, rowStatus, StatusText, TopicList, usd } from "./ImportReview";
import { humanizeAdminField } from "./admin-schema";
import { checkPasses, PDF_IMPORT_MAX_FILES, rowPasses, type ImportRow } from "./admin-import";
import { DesignHeader, ErrorNote, FileChecksList, InputNote, Kbd, PageCount, PdfRows, SourceTabs, StageFade } from "./import-design-parts";
import { action, CollectionsButton, type ImportFlowState } from "./import-flow";

/**
 * Design 3, one record at a time: a strip of segments shows every record's
 * state, the current record takes the whole dialog, and the editor keeps it
 * or leaves it out from the keyboard, moving on to the next one.
 */
export function DesignQueue({ flow }: { flow: ImportFlowState }) {
	const { stage } = flow;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<DesignHeader stage={stage}>
				{stage === "review" ? (
					<Button isDisabled={flow.locked} onPress={flow.restart} size="sm" variant="transparent">
						Start over
					</Button>
				) : null}
				<Button aria-label="Close" className="size-8 min-w-8" isIconOnly onPress={flow.onClose} size="xs" variant="transparent">
					<HugeiconsIcon aria-hidden icon={Cancel01Icon} size={16} />
				</Button>
			</DesignHeader>
			<StageFade stage={stage}>
				{stage === "input" ? <QueueInput flow={flow} /> : null}
				{stage === "review" && flow.batch ? <Queue flow={flow} /> : null}
				{stage === "done" && flow.batch?.results ? (
					<div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
						<ImportDone batch={flow.batch} onChoose={flow.choosePublish} onOpenRecord={flow.onOpenRecord} onPublish={flow.publish} />
					</div>
				) : null}
			</StageFade>
			{stage !== "review" ? (
				<footer className="flex h-16 shrink-0 items-center gap-3 border-t border-black/[0.06] px-6 dark:border-white/[0.06]">
					<InputNote flow={flow} />
					<span className="ms-auto flex items-center gap-2">
						{stage === "input" ? (
							<Button className="min-w-28" color="accent" isDisabled={flow.problem !== null} isLoading={flow.busy} onPress={flow.start} size="sm" variant="solid">
								{flow.primaryLabel}
							</Button>
						) : (
							<>
								<Button onPress={flow.restart} size="sm" variant="transparent">
									Import more
								</Button>
								<Button className="min-w-24" color="accent" onPress={flow.finish} size="sm" variant="solid">
									Done
								</Button>
							</>
						)}
					</span>
				</footer>
			) : null}
		</div>
	);
}

/** One column: what to add, then what every PDF is checked for. */
function QueueInput({ flow }: { flow: ImportFlowState }) {
	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			<div className="mx-auto w-full max-w-[40rem] px-6 pb-8 pt-5">
				<SourceTabs
					dois={<DoiInput busy={flow.busy} narrow onChange={flow.setDoiText} text={flow.doiText} />}
					files={<BibliographyInput busy={flow.busy} files={flow.files} onFilesChange={flow.setFiles} />}
					flow={flow}
					pdfs={
						<div className="flex flex-col gap-8">
							<div className="flex flex-col gap-3">
								<DropArea accept={PDF_ACCEPT} busy={flow.busy} className={flow.pdfs.length ? "h-20" : "h-60"} label="PDFs" onFiles={(chosen) => flow.setPdfs(withNew(flow.pdfs, chosen))}>
									<DropText hint={`Up to ${PDF_IMPORT_MAX_FILES} PDFs, 50 MB each. Claude Haiku 5.5 reads each one.`} what="PDFs" />
								</DropArea>
								{flow.pdfs.length ? <PdfRows busy={flow.busy} files={flow.pdfs} onFilesChange={flow.setPdfs} perPage={5} /> : null}
							</div>
							<div>
								<ChecksEditor busy={flow.busy} criteria={flow.checks} fileNote={false} onChange={flow.setChecks} />
								<p className="mb-1 mt-5 text-xs text-black/45 dark:text-white/45">From the file itself, for every PDF</p>
								<FileChecksList />
							</div>
						</div>
					}
				/>
			</div>
		</div>
	);
}

/** A segment's colour: kept and passing, kept with checks to fix, left out, or not settled yet. */
function segmentTone(row: ImportRow, kept: boolean) {
	if (row.state === "waiting") return "bg-black/[0.07] dark:bg-white/[0.08]";
	if (row.state === "reading") return "animate-pulse bg-black/[0.12] dark:bg-white/[0.14]";
	if (row.state === "failed" || row.record?.state !== "ready") return "bg-danger/40";
	if (!kept) return "bg-black/20 dark:bg-white/20";
	return !row.file || rowPasses(row) ? "bg-emerald-500" : "bg-amber-500";
}

function Queue({ flow }: { flow: ImportFlowState }) {
	const batch = flow.batch!;
	const rows = batch.rows;
	const index = Math.max(0, rows.findIndex(({ id }) => id === flow.activeRow?.id));
	const row = rows[index];
	const go = (next: number) => {
		const target = rows[Math.min(rows.length - 1, Math.max(0, next))];
		if (target) flow.setActiveId(target.id);
	};
	const decide = (keep: boolean) => {
		if (!row || row.record?.state !== "ready" || flow.locked) return;
		const next = new Set(flow.selected);
		if (keep) next.add(row.id);
		else next.delete(row.id);
		flow.setSelected(next);
		go(index + 1);
	};
	// The arrow keys move through the records; Enter keeps one and X leaves it out.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, button, [contenteditable], [role=dialog] [role=menu]")) return;
			if (event.key === "ArrowRight") go(index + 1);
			else if (event.key === "ArrowLeft") go(index - 1);
			else if (event.key === "Enter") decide(true);
			else if (event.key.toLowerCase() === "x") decide(false);
			else return;
			event.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});
	if (!row) return null;
	const kept = flow.selected.has(row.id);
	const ready = row.record?.state === "ready";
	const keptCount = flow.selected.size;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="shrink-0 px-8 pt-4">
				<div aria-label="Records" className="flex h-3 items-center gap-[3px]" role="group">
					{rows.map((other, position) => (
						<Tooltip content={other.record?.title ?? other.file?.name ?? other.record?.source} key={other.id}>
							<button
								aria-current={position === index || undefined}
								aria-label={`Record ${position + 1}`}
								className={`h-1.5 min-w-1 flex-1 rounded-full outline-none transition-[background-color,height] duration-300 focus-visible:ring-2 focus-visible:ring-accent ${position === index ? "h-3" : ""} ${segmentTone(other, flow.selected.has(other.id))}`}
								onClick={() => go(position)}
								type="button"
							/>
						</Tooltip>
					))}
				</div>
				<div className="mt-3 flex h-8 items-center gap-3 text-xs tabular-nums text-black/55 dark:text-white/55">
					<span>
						Record {index + 1} of {rows.length}
					</span>
					<span className="text-black/35 dark:text-white/35">{flow.counts.done < flow.counts.total ? `${flow.counts.done} of ${flow.counts.total} read` : `Read for ${usd(flow.costUsd)}`}</span>
					<span className="ms-auto flex items-center gap-1">
						<Button aria-label="Previous record" className="size-8 min-w-8" isDisabled={index === 0} isIconOnly onPress={() => go(index - 1)} size="xs" variant="transparent">
							<HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} size={15} />
						</Button>
						<Button aria-label="Next record" className="size-8 min-w-8" isDisabled={index === rows.length - 1} isIconOnly onPress={() => go(index + 1)} size="xs" variant="transparent">
							<HugeiconsIcon aria-hidden icon={ArrowRight01Icon} size={15} />
						</Button>
					</span>
				</div>
			</div>
			<div className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1fr)] gap-10 border-t border-black/[0.06] px-8 dark:border-white/[0.06]">
				<aside className="flex flex-col gap-3 pt-6">
					<ImportCover className="w-full" file={row.file} itemType={row.record?.itemType} reading={row.state === "reading"} size={28} />
					{row.file ? (
						<>
							<p className="flex items-baseline gap-2 text-xs text-black/55 dark:text-white/55">
								<span className="min-w-0 flex-1 truncate">{row.file.name}</span>
								<PageCount file={row.file} />
							</p>
							<div className="flex flex-wrap gap-2">
								<Button onPress={() => window.open(URL.createObjectURL(row.file!), "_blank", "noopener")} size="xs" startContent={<HugeiconsIcon aria-hidden icon={SquareArrowUpRight02Icon} size={13} />} variant="muted">
									Open PDF
								</Button>
								{row.record && row.pdf?.writable ? (
									<Button onPress={() => void openWithProperties(row.file!, flow.propertiesOf(row))} size="xs" startContent={<HugeiconsIcon aria-hidden icon={FileExportIcon} size={13} />} variant="muted">
										With new properties
									</Button>
								) : null}
							</div>
						</>
					) : null}
				</aside>
				<div className="min-h-0 overflow-y-auto py-6 pe-1" key={row.id}>
					<QueueRecord flow={flow} row={row} />
				</div>
			</div>
			<footer className="flex h-16 shrink-0 items-center gap-3 border-t border-black/[0.06] px-6 dark:border-white/[0.06]">
				<ErrorNote flow={flow} />
				{!flow.error ? <CollectionsButton collections={batch.collections} locked={flow.locked} onChange={flow.setCollections} sources={flow.sources} /> : null}
				<span className="mx-auto flex items-center gap-2">
					<Button aria-pressed={ready && !kept} className="min-w-36" isDisabled={!ready || flow.locked} onPress={() => decide(false)} size="sm" variant="muted">
						Leave out <Kbd>X</Kbd>
					</Button>
					<Button aria-pressed={ready && kept} className="min-w-36" isDisabled={!ready || flow.locked} onPress={() => decide(true)} size="sm" startContent={<HugeiconsIcon aria-hidden icon={Tick02Icon} size={14} />} variant="muted">
						Keep <Kbd>Enter</Kbd>
					</Button>
				</span>
				<Button className="min-w-32" color="accent" isDisabled={flow.reading || keptCount === 0} isLoading={flow.locked} onPress={flow.commit} size="sm" variant="solid">
					{action("Import", keptCount, "record", "records")}
				</Button>
			</footer>
		</div>
	);
}

function QueueRecord({ flow, row }: { flow: ImportFlowState; row: ImportRow }) {
	const record = row.record;
	const payload = record?.payload ?? {};
	const abstract = typeof payload.abstractNote === "string" ? payload.abstractNote : null;
	const settled = row.state === "read" || row.state === "failed";
	const checks = flow.checksOf(row);
	const result = flow.resultById.get(row.id);
	const properties = flow.propertiesOf(row);
	const kindLine = [record?.itemType ? humanizeAdminField(record.itemType) : null, record?.year].filter(Boolean);
	return (
		<article className="flex max-w-[44rem] flex-col gap-7">
			<header className="flex flex-col gap-1.5">
				<p className="flex h-4 gap-3 text-xs text-black/45 dark:text-white/45">
					{kindLine.map((part) => (
						<span key={String(part)}>{part}</span>
					))}
				</p>
				<h3 className={`text-xl font-semibold leading-7 ${record?.title ? "text-black/90 dark:text-white/90" : "text-black/40 dark:text-white/40"}`}>{record?.title ?? row.file?.name ?? record?.source}</h3>
				{record?.creators.length ? <p className="text-sm text-black/60 dark:text-white/60">{record.creators.join(", ")}</p> : null}
				<div className="mt-1">
					<StatusText status={rowStatus(row, result, flow.batch?.attach.get(row.id))} />
				</div>
				{row.message ? <p className="text-xs text-danger">{row.message}</p> : null}
			</header>
			{!settled ? (
				<ReadingPlaceholder />
			) : (
				<div className="flex animate-fade-in flex-col gap-7 [animation-duration:300ms]">
					{record ? <MetadataLine payload={payload} /> : null}
					{abstract ? (
						<DetailSection aside={row.abstractWritten ? "Written by AI, the PDF has none" : undefined} title="Abstract">
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
				</div>
			)}
		</article>
	);
}
