"use client";

import { ArrowLeft01Icon, ArrowRight01Icon, ArrowRight02Icon, CheckListIcon, FileEditIcon, FileExportIcon, SquareArrowUpRight02Icon, Tag01Icon, TextIcon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";

import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import { Abstract, CheckMeter, Checks, creatorsLine, MetadataLine, openWithProperties, PdfPropertiesList, propertiesAside, ReadingPlaceholder, RightsFixLine, rowStatus, StatusText, TopicList, usd } from "./ImportReview";
import { humanizeAdminField } from "./admin-schema";
import { checkPasses, rowPasses, type ImportRow, type ReviewFilter } from "./admin-import";
import { CollectionsSetting } from "./ImportAdd";
import { ListHeader, Setting, SettingsGroup, SheetTabs } from "./import-parts";
import type { ImportFlowState } from "./import-flow";

const ROWS_PER_PAGE = 8;

/** Which records the review shows, in the same tabs as the sources on the Add step. */
export function ReviewTabs({ flow }: { flow: ImportFlowState }) {
	const { counts } = flow;
	const tabs: { count: number; id: ReviewFilter; label: string }[] = [
		{ count: counts.total, id: "all", label: "All" },
		{ count: counts.ready, id: "ready", label: "Ready" },
		{ count: counts.existing, id: "existing", label: "In the library" },
		{ count: counts.attention, id: "attention", label: "Needs attention" },
		...(flow.batch?.kind === "pdfs" ? [{ count: counts.improve, id: "improve" as const, label: "Checks to improve" }] : []),
	];
	return <SheetTabs label="Show" onSelect={flow.setFilter} panelId="import-review-panel" selected={flow.filter} tabs={tabs} />;
}

/**
 * The review, built like the Add step: the Collections setting at the top,
 * then the records as a list. A record opens as its own page in the sheet,
 * its parts in rows that open in place, with the way back and to the next.
 */
export function ImportReviewStep({ flow }: { flow: ImportFlowState }) {
	const reduceMotion = useReducedMotion();
	const [openId, setOpenId] = useState<string | null>(null);
	// Here rather than in the list, so coming back from a record keeps the page.
	const [page, setPage] = useState(1);
	const open = flow.shown.find(({ id }) => id === openId) ?? null;
	const back = () => {
		// The page holding the record last open, which Next may have moved past the one left.
		if (open) setPage(Math.floor(flow.shown.indexOf(open) / ROWS_PER_PAGE) + 1);
		setOpenId(null);
	};
	return (
		<div aria-labelledby={`import-review-panel-tab-${flow.filter}`} className="relative flex min-h-0 flex-1 flex-col" id="import-review-panel" role="tabpanel">
			<AnimatePresence initial={false} mode="popLayout">
				<motion.div
					animate={{ opacity: 1, x: 0 }}
					className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5 pt-5 [scrollbar-gutter:stable]"
					exit={{ opacity: 0, x: open ? -16 : 16 }}
					initial={{ opacity: 0, x: open ? 16 : -16 }}
					key={open ? "record" : "list"}
					transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.32, 0.72, 0, 1] }}
				>
					{open ? <RecordPage flow={flow} key={open.id} onBack={back} onOpen={setOpenId} row={open} /> : <RecordList flow={flow} onOpen={setOpenId} onPage={setPage} page={page} />}
				</motion.div>
			</AnimatePresence>
		</div>
	);
}

function choose(flow: ImportFlowState, id: string, checked: boolean) {
	const next = new Set(flow.selected);
	if (checked) next.add(id);
	else next.delete(id);
	flow.setSelected(next);
}

function RecordList({ flow, onOpen, onPage, page }: { flow: ImportFlowState; onOpen: (id: string) => void; onPage: (page: number) => void; page: number }) {
	const { current, items, pages } = pageOf(flow.shown, page, ROWS_PER_PAGE);
	const all = flow.readyIds.length > 0 && flow.readyIds.every((id) => flow.selected.has(id));
	const pdfs = flow.batch?.kind === "pdfs";
	return (
		<div className="flex flex-col gap-5">
			<SettingsGroup>
				<CollectionsSetting flow={flow} />
			</SettingsGroup>
			<div className="flex flex-col gap-2">
				<ListHeader
					aside={pdfs ? (flow.reading ? `${flow.counts.done} of ${flow.counts.total} read` : `Read for ${usd(flow.costUsd)}`) : undefined}
					lead={<Checkbox aria-label="Choose every ready record" isDisabled={flow.locked || !flow.readyIds.length} isIndeterminate={flow.selected.size > 0 && !all} isSelected={all} onValueChange={(checked) => flow.setSelected(new Set(checked ? flow.readyIds : []))} size="sm" />}
					title={`${flow.selected.size} of ${flow.readyIds.length} chosen`}
				/>
				<ul className="flex flex-col">
					{items.map((row) => {
						const title = row.record?.title ?? row.file?.name ?? row.record?.source ?? "";
						const status = rowStatus(row, flow.resultById.get(row.id), flow.batch?.attach.get(row.id));
						return (
							<li className="flex items-center gap-3 rounded-lg pe-1 ps-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]" key={row.id}>
								<Checkbox aria-label={`Import ${title}`} isDisabled={flow.locked || row.record?.state !== "ready"} isSelected={flow.selected.has(row.id)} onValueChange={(checked) => choose(flow, row.id, checked)} size="sm" />
								<button className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-md py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => onOpen(row.id)} type="button">
									<ImportCover className="w-8" file={row.file} itemType={row.record?.itemType} reading={row.state === "reading"} size={12} />
									<span className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className={`line-clamp-2 text-sm leading-5 ${row.record?.title ? "font-medium text-black/85 dark:text-white/85" : "text-black/45 dark:text-white/45"}`}>{title}</span>
										<span className="flex items-center gap-2">
											{status.label === "Ready" && row.record ? (
												<span className="min-w-0 flex-1 truncate text-xs text-black/50 dark:text-white/50">{creatorsLine(row.record.creators) || "No authors"}</span>
											) : (
												<span className="min-w-0 flex-1">
													<StatusText status={status} />
												</span>
											)}
											<CheckMeter checks={flow.checksOf(row)} count={row.file ? flow.checkCount : 0} />
										</span>
									</span>
									<HugeiconsIcon aria-hidden className="shrink-0 text-black/30 dark:text-white/30" icon={ArrowRight01Icon} size={15} />
								</button>
							</li>
						);
					})}
					{!items.length ? <li className="flex h-28 items-center justify-center text-sm text-black/45 dark:text-white/45">Nothing here</li> : null}
				</ul>
				<ImportPager label="Pages of records" onChange={onPage} page={current} pages={pages} perPage={ROWS_PER_PAGE} total={flow.shown.length} />
			</div>
		</div>
	);
}

/** Why a record can't be imported: each field it gets wrong, or the general message. */
function attentionReason(record: NonNullable<ImportRow["record"]>) {
	const fields = Object.entries(record.fields ?? {});
	return fields.length ? fields.map(([field, message]) => `${humanizeAdminField(field)}: ${message}`).join(" ") : record.message;
}

/** One record as its own page: who wrote it, then its parts in rows like the Add step's settings. */
function RecordPage({ flow, onBack, onOpen, row }: { flow: ImportFlowState; onBack: () => void; onOpen: (id: string) => void; row: ImportRow }) {
	const index = flow.shown.findIndex(({ id }) => id === row.id);
	const previous = flow.shown[index - 1];
	const next = flow.shown[index + 1];
	const record = row.record;
	const payload = record?.payload ?? {};
	const abstract = typeof payload.abstractNote === "string" ? payload.abstractNote : null;
	const settled = row.state === "read" || row.state === "failed";
	const checks = flow.checksOf(row);
	const result = flow.resultById.get(row.id);
	const openKey = result?.itemKey ?? record?.existingKey;
	const properties = flow.propertiesOf(row);
	const kindLine = [record?.itemType ? humanizeAdminField(record.itemType) : null, record?.year].filter(Boolean);
	const title = record?.title ?? row.file?.name ?? record?.source ?? "";
	return (
		<div className="flex flex-col gap-5">
			<div className="-mx-1.5 -mt-2 flex h-9 items-center gap-1">
				<Button onPress={onBack} size="xs" startContent={<HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} size={14} />} variant="transparent">
					All records
				</Button>
				<span className="ms-auto text-xs tabular-nums text-black/45 dark:text-white/45">
					{index + 1} of {flow.shown.length}
				</span>
				<Button aria-label="Previous record" className="size-8 min-w-8" isDisabled={!previous} isIconOnly onPress={() => previous && onOpen(previous.id)} size="xs" variant="transparent">
					<HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} size={15} />
				</Button>
				<Button aria-label="Next record" className="size-8 min-w-8" isDisabled={!next} isIconOnly onPress={() => next && onOpen(next.id)} size="xs" variant="transparent">
					<HugeiconsIcon aria-hidden icon={ArrowRight01Icon} size={15} />
				</Button>
			</div>
			<header className="flex gap-4">
				<ImportCover className="w-16 self-start" file={row.file} itemType={record?.itemType} reading={row.state === "reading"} size={18} />
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<p className="flex h-4 gap-3 text-xs text-black/45 dark:text-white/45">
						{kindLine.map((part) => (
							<span key={String(part)}>{part}</span>
						))}
					</p>
					<h3 className={`text-base font-semibold leading-6 ${record?.title ? "text-black/90 dark:text-white/90" : "text-black/40 dark:text-white/40"}`}>{title}</h3>
					{record?.creators.length ? <p className="text-sm text-black/60 dark:text-white/60">{record.creators.join(", ")}</p> : null}
					<div className="mt-1 flex items-center gap-3">
						<StatusText status={rowStatus(row, result, flow.batch?.attach.get(row.id))} />
						{record?.state === "ready" ? (
							<span className="ms-auto">
								<Checkbox isDisabled={flow.locked} isSelected={flow.selected.has(row.id)} onValueChange={(checked) => choose(flow, row.id, checked)} size="sm">
									<span className="text-xs text-black/70 dark:text-white/70">Import this record</span>
								</Checkbox>
							</span>
						) : null}
					</div>
					{row.message ? <p className="text-xs text-danger">{row.message}</p> : null}
					{record?.state === "attention" ? <p className="text-xs leading-5 text-danger">{attentionReason(record)}</p> : null}
				</div>
			</header>
			{record ? <MetadataLine payload={payload} /> : null}
			{!settled ? (
				<ReadingPlaceholder />
			) : (
				<div className="animate-fade-in [animation-duration:300ms]">
					<SettingsGroup>
						{abstract ? (
							<Setting icon={TextIcon} summary={row.abstractWritten ? "Written by AI" : "From the PDF"} title="Abstract">
								<Abstract text={abstract} />
							</Setting>
						) : null}
						{row.file && flow.checkCount ? (
							<Setting defaultOpen={!rowPasses(row)} icon={CheckListIcon} summary={`${checks.filter(checkPasses).length} of ${flow.checkCount} pass`} title="AI checks">
								<Checks checks={checks}>{row.rightsFix ? <RightsFixLine applied={row.fixApplied} fix={row.rightsFix} locked={flow.locked} onToggle={() => flow.toggleFix(row.id)} stated={typeof payload.rights === "string" ? payload.rights : ""} /> : null}</Checks>
							</Setting>
						) : null}
						{row.topics.length ? (
							<Setting icon={Tag01Icon} summary={`${flow.topicsOf(row).size} of ${row.topics.length} chosen`} title="Topics">
								<TopicList chosen={flow.topicsOf(row)} locked={flow.locked} onToggle={(topicId) => flow.toggleTopic(row.id, topicId)} topics={row.topics} />
							</Setting>
						) : null}
						{row.file && record && row.pdf ? (
							<Setting icon={FileEditIcon} summary={propertiesAside(properties, row.pdf)} title="PDF properties">
								<PdfPropertiesList after={properties} now={row.pdf} />
							</Setting>
						) : null}
					</SettingsGroup>
				</div>
			)}
			<div className="flex flex-wrap gap-2 empty:hidden">
				{row.file ? (
					<Button onPress={() => window.open(URL.createObjectURL(row.file!), "_blank", "noopener")} size="xs" startContent={<HugeiconsIcon aria-hidden icon={SquareArrowUpRight02Icon} size={13} />} variant="muted">
						Open PDF
					</Button>
				) : null}
				{row.file && record && row.pdf?.writable ? (
					<Button onPress={() => void openWithProperties(row.file!, properties)} size="xs" startContent={<HugeiconsIcon aria-hidden icon={FileExportIcon} size={13} />} variant="muted">
						Open with new properties
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
