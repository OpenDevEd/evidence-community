"use client";

import {
	AlertCircleIcon,
	ArrowRight01Icon,
	Building03Icon,
	Calendar03Icon,
	CancelCircleIcon,
	CheckListIcon,
	CheckmarkCircle02Icon,
	Copy01Icon,
	Globe02Icon,
	HelpCircleIcon,
	Idea01Icon,
	Link01Icon,
	Loading03Icon,
	SquareArrowUpRight02Icon,
	Tick02Icon,
	CopyrightIcon,
	FileExportIcon,
	Undo02Icon,
} from "@hugeicons/core-free-icons";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";
import type { AdminImportCommitResult, PdfCheckResult, TopicSuggestion } from "@/lib/admin/item-import-contract";
import type { PdfProperties, PdfPropertiesReading } from "@/lib/admin/pdf-properties";

import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import type { ImportKind } from "./ImportSteps";
import { InspectorSection } from "./InspectorSection";
import { humanizeAdminField } from "./admin-schema";
import { reviewFrom, storedReview, topicPath, type AttachState, type ImportRow, type ReviewCheck, type ReviewFilter } from "./admin-import";

const ROWS_PER_PAGE = 8;

const resultLook: Record<PdfCheckResult["result"], { bar: string; icon: typeof Tick02Icon; label: string; tone: string }> = {
	met: { bar: "bg-emerald-500", icon: CheckmarkCircle02Icon, label: "Met", tone: "text-emerald-600 dark:text-emerald-400" },
	not_met: { bar: "bg-danger", icon: CancelCircleIcon, label: "Not met", tone: "text-danger" },
	unclear: { bar: "bg-amber-500", icon: HelpCircleIcon, label: "Unclear", tone: "text-amber-600 dark:text-amber-400" },
};

type Tone = "attention" | "neutral" | "progress" | "ready";
const toneClass: Record<Tone, string> = {
	attention: "text-amber-700 dark:text-amber-400",
	neutral: "text-black/50 dark:text-white/50",
	progress: "text-black/50 dark:text-white/50",
	ready: "text-emerald-700 dark:text-emerald-400",
};

type Status = { icon: typeof Tick02Icon | null; label: string; tone: Tone };

/** What a row's status says, from its reading, its preview, its import and its PDF. */
function rowStatus(row: ImportRow, result: AdminImportCommitResult | undefined, attach: AttachState | undefined): Status {
	if (row.state === "waiting") return { icon: null, label: "Queued", tone: "progress" };
	if (row.state === "reading") return { icon: null, label: "Reading", tone: "progress" };
	if (row.state === "failed" || !row.record) return { icon: AlertCircleIcon, label: "Could not read", tone: "attention" };
	if (result?.outcome === "failed") return { icon: AlertCircleIcon, label: "Not imported", tone: "attention" };
	if (attach === "attaching") return { icon: null, label: "Attaching the PDF", tone: "progress" };
	if (attach === "failed") return { icon: AlertCircleIcon, label: "PDF not attached", tone: "attention" };
	if (result?.outcome === "created") return { icon: Tick02Icon, label: "Draft created", tone: "ready" };
	const states = {
		attention: { icon: AlertCircleIcon, label: "Needs attention", tone: "attention" },
		existing: { icon: Copy01Icon, label: "In the library", tone: "neutral" },
		ready: { icon: Tick02Icon, label: "Ready", tone: "ready" },
		repeated: { icon: Copy01Icon, label: "Repeated", tone: "neutral" },
		unresolved: { icon: AlertCircleIcon, label: "Not found", tone: "attention" },
	} as const;
	return states[row.record.state];
}

function StatusText({ status }: { status: Status }) {
	return (
		<span className={`flex min-w-0 items-center gap-1.5 text-xs ${toneClass[status.tone]}`}>
			{status.tone === "progress" ? <HugeiconsIcon aria-hidden className="shrink-0 animate-spin motion-reduce:animate-none" icon={Loading03Icon} size={13} /> : status.icon ? <HugeiconsIcon aria-hidden className="shrink-0" icon={status.icon} size={13} /> : null}
			<span className="truncate">{status.label}</span>
		</span>
	);
}

/** A check's look: the AI's answer, or a pass labelled fixed once the editor fixed it. */
const fixedLook = { ...resultLook.met, label: "Fixed" };
const lookOf = (check: ReviewCheck) => (check.fixed ? fixedLook : resultLook[check.result]);

/** One small bar per check, coloured by its result; grey until the PDF is read. */
function CheckMeter({ checks, count }: { checks: ReviewCheck[]; count: number }) {
	if (!count) return null;
	const passed = checks.filter((check) => check.fixed || check.result === "met").length;
	return (
		<span aria-label={checks.length ? `${passed} of ${count} checks pass` : `${count} checks`} className="flex shrink-0 items-center gap-1.5" role="img">
			<span className="flex gap-[3px]">
				{Array.from({ length: count }, (_, index) => (
					<span className={`h-2.5 w-1 rounded-full transition-colors duration-500 ${checks[index] ? lookOf(checks[index]).bar : "bg-black/10 dark:bg-white/10"}`} key={index} />
				))}
			</span>
			<span className={`w-6 text-xs tabular-nums text-black/45 transition-opacity duration-300 dark:text-white/45 ${checks.length ? "" : "opacity-0"}`}>
				{passed}/{count}
			</span>
		</span>
	);
}

function creatorsLine(creators: readonly string[]) {
	if (creators.length <= 2) return creators.join(" and ");
	return `${creators[0]} and ${creators.length - 1} more`;
}

const FILTERS: { filter: ReviewFilter; label: string; pdfOnly?: boolean }[] = [
	{ filter: "all", label: "All" },
	{ filter: "ready", label: "Ready" },
	{ filter: "existing", label: "In the library" },
	{ filter: "attention", label: "Needs attention" },
	{ filter: "improve", label: "Checks to improve", pdfOnly: true },
];

/** Dollars to the cent, and "under $0.01" below that. */
export function usd(amount: number) {
	return amount > 0 && amount < 0.01 ? "under $0.01" : `$${amount.toFixed(2)}`;
}

export type ReviewCounts = Record<"attention" | "done" | "existing" | "improve" | "ready" | "total", number>;

/** The filters, each with its count, and reading progress while PDFs are read. */
export function ReviewBar({ costUsd, counts, filter, kind, onFilter }: { costUsd: number; counts: ReviewCounts; filter: ReviewFilter; kind: ImportKind; onFilter: (filter: ReviewFilter) => void }) {
	const reading = counts.done < counts.total;
	return (
		<div className="flex h-8 items-center gap-4">
			<div aria-label="Show" className="flex items-center gap-0.5" role="group">
				{FILTERS.filter((option) => kind === "pdfs" || !option.pdfOnly).map((option) => {
					const active = filter === option.filter;
					const count = option.filter === "all" ? counts.total : counts[option.filter];
					return (
						<button
							aria-pressed={active}
							className={`flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent ${active ? "bg-black/[0.06] font-medium text-black/85 dark:bg-white/10 dark:text-white/90" : "text-black/55 hover:bg-black/[0.03] hover:text-black/75 dark:text-white/55 dark:hover:bg-white/[0.05] dark:hover:text-white/75"}`}
							key={option.filter}
							onClick={() => onFilter(option.filter)}
							type="button"
						>
							{option.label}
							<span className="tabular-nums text-black/40 dark:text-white/40">{count}</span>
						</button>
					);
				})}
			</div>
			{kind === "pdfs" ? (
				<div className="ms-auto flex items-center gap-2.5">
					<span className="text-xs tabular-nums text-black/55 dark:text-white/55">{reading ? `${counts.done} of ${counts.total} read` : `Read for ${usd(costUsd)}`}</span>
					<span aria-hidden className={`relative h-1 w-24 overflow-hidden rounded-full bg-black/[0.08] transition-opacity duration-500 dark:bg-white/10 ${reading ? "" : "opacity-0"}`}>
						<span className="absolute inset-0 origin-left rounded-full bg-accent transition-transform duration-700 ease-out motion-reduce:transition-none" style={{ transform: `scaleX(${counts.total ? counts.done / counts.total : 0})` }} />
					</span>
				</div>
			) : null}
		</div>
	);
}

export function ReviewList({
	activeId,
	attach,
	checksOf,
	criteriaCount,
	filter,
	locked,
	onActivate,
	onSelectedChange,
	readyIds,
	results,
	rows,
	selected,
}: {
	activeId: string | null;
	attach: ReadonlyMap<string, AttachState>;
	checksOf: (row: ImportRow) => ReviewCheck[];
	criteriaCount: number;
	filter: ReviewFilter;
	locked: boolean;
	onActivate: (id: string) => void;
	onSelectedChange: (selected: Set<string>) => void;
	/** Every ready record in the import, shown or not, for the choose-all box. */
	readyIds: string[];
	results: AdminImportCommitResult[] | null;
	rows: ImportRow[];
	selected: Set<string>;
}) {
	const [pageByFilter, setPageByFilter] = useState<Partial<Record<ReviewFilter, number>>>({});
	const { current, items, pages } = pageOf(rows, pageByFilter[filter] ?? 1, ROWS_PER_PAGE);
	const all = readyIds.length > 0 && readyIds.every((id) => selected.has(id));
	const resultById = new Map((results ?? []).map((result) => [result.id, result]));
	return (
		<div className="flex flex-col">
			<div className="flex h-9 items-center gap-3 border-b border-black/[0.06] px-2 text-xs text-black/50 dark:border-white/[0.06] dark:text-white/50">
				<Checkbox
					aria-label="Choose every ready record"
					isDisabled={locked || !readyIds.length}
					isIndeterminate={selected.size > 0 && !all}
					isSelected={all}
					onValueChange={(checked) => onSelectedChange(new Set(checked ? readyIds : []))}
					size="sm"
				/>
				<span className="tabular-nums">
					{selected.size} of {readyIds.length} chosen
				</span>
			</div>
			<ul className="flex flex-col py-1">
				{items.map((row) => {
					const active = row.id === activeId;
					const status = rowStatus(row, resultById.get(row.id), attach.get(row.id));
					const title = row.record?.title ?? row.file?.name ?? row.record?.source ?? "";
					return (
						<li className={`flex h-[4.5rem] items-center gap-3 rounded-lg px-2 transition-colors duration-150 ${active ? "bg-black/[0.05] dark:bg-white/[0.07]" : "hover:bg-black/[0.025] dark:hover:bg-white/[0.03]"}`} key={row.id}>
							<Checkbox
								aria-label={`Import ${title}`}
								isDisabled={locked || row.record?.state !== "ready"}
								isSelected={selected.has(row.id)}
								onValueChange={(checked) => {
									const next = new Set(selected);
									if (checked) next.add(row.id);
									else next.delete(row.id);
									onSelectedChange(next);
								}}
								size="sm"
							/>
							<button aria-current={active || undefined} className="flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => onActivate(row.id)} type="button">
								<ImportCover className="w-9" file={row.file} itemType={row.record?.itemType} reading={row.state === "reading"} size={13} />
								<span className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span className={`line-clamp-2 text-sm leading-5 ${row.record?.title ? "font-medium text-black/85 dark:text-white/85" : "text-black/45 dark:text-white/45"}`}>{title}</span>
									<span className="flex items-center gap-2">
										{status.label === "Ready" ? (
											<span className="flex min-w-0 flex-1 gap-2 text-xs text-black/50 dark:text-white/50">
												<span className="truncate">{creatorsLine(row.record!.creators) || "No authors"}</span>
												{row.record!.year ? <span className="shrink-0 tabular-nums">{row.record!.year}</span> : null}
											</span>
										) : (
											<span className="min-w-0 flex-1">
												<StatusText status={status} />
											</span>
										)}
										<CheckMeter checks={checksOf(row)} count={row.file ? criteriaCount : 0} />
									</span>
								</span>
							</button>
						</li>
					);
				})}
				{!items.length ? <li className="flex h-28 items-center justify-center text-sm text-black/45 dark:text-white/45">Nothing here</li> : null}
			</ul>
			<ImportPager label="Pages of records" onChange={(page) => setPageByFilter((value) => ({ ...value, [filter]: page }))} page={current} pages={pages} perPage={ROWS_PER_PAGE} total={rows.length} />
		</div>
	);
}

/** The answer to each check; a failed one with a fix offers to write it into the record's Rights. */
function CheckList({ checks, locked = false, onFix }: { checks: ReviewCheck[]; locked?: boolean; onFix?: (index: number) => void }) {
	return (
		<ul className="flex flex-col gap-4">
			{checks.map((check, index) => {
				const look = lookOf(check);
				return (
					<li className="flex gap-2.5" key={check.criterion}>
						<HugeiconsIcon aria-label={look.label} className={`mt-0.5 shrink-0 ${look.tone}`} icon={look.icon} size={16} />
						<div className="min-w-0 flex-1 text-sm">
							<p className="text-black/85 dark:text-white/85">{check.criterion}</p>
							{check.quote ? (
								<p className="mt-1 text-xs leading-5 text-black/55 dark:text-white/55">
									<q>{check.quote}</q>
									{check.page ? <span className="ms-1.5 whitespace-nowrap tabular-nums text-black/40 dark:text-white/40">p. {check.page}</span> : null}
								</p>
							) : null}
							{check.recommendation ? (
								<p className="mt-1 flex gap-1.5 text-xs leading-5 text-amber-800 dark:text-amber-300">
									<HugeiconsIcon aria-hidden className="mt-[3px] shrink-0" icon={Idea01Icon} size={12} />
									{check.recommendation}
								</p>
							) : null}
							{check.result !== "met" && check.fix ? <FixLine check={check} locked={locked} onFix={onFix && (() => onFix(index))} /> : null}
						</div>
					</li>
				);
			})}
		</ul>
	);
}

function FixLine({ check, locked, onFix }: { check: ReviewCheck; locked: boolean; onFix?: () => void }) {
	if (!onFix && !check.fixed) return null;
	return (
		<div className="mt-2 flex min-h-8 items-center gap-3">
			<p className="flex min-w-0 flex-1 gap-1.5 text-xs leading-5 text-black/60 dark:text-white/60">
				<HugeiconsIcon aria-hidden className="mt-[3px] shrink-0 text-black/35 dark:text-white/35" icon={CopyrightIcon} size={12} />
				<span className="min-w-0">
					{check.fixed ? "Rights include " : "Fix writes "}
					<q className="text-black/80 dark:text-white/80">{check.fix}</q>
					{check.fixed ? null : " into Rights"}
				</span>
			</p>
			{onFix ? (
				<Button className="h-8 min-h-8 min-w-[4.5rem] shrink-0" isDisabled={locked} onPress={onFix} size="xs" startContent={<HugeiconsIcon aria-hidden icon={check.fixed ? Undo02Icon : Tick02Icon} size={13} />} variant={check.fixed ? "transparent" : "muted"}>
					{check.fixed ? "Undo" : "Fix"}
				</Button>
			) : null}
		</div>
	);
}

function TopicList({ chosen, locked, onToggle, topics }: { chosen: ReadonlySet<string>; locked: boolean; onToggle: (id: string) => void; topics: TopicSuggestion[] }) {
	return (
		<ul className="flex flex-col gap-3">
			{topics.map((topic) => (
				<li className="flex gap-2.5" key={topic.id}>
					<Checkbox aria-label={`Add ${topic.name}`} className="mt-0.5 self-start" isDisabled={locked} isSelected={chosen.has(topic.id)} onValueChange={() => onToggle(topic.id)} size="sm" />
					<div className="min-w-0 flex-1">
						<p className="flex items-baseline gap-2 text-sm">
							<span className="text-black/85 dark:text-white/85">{topic.name}</span>
							<span className={`ms-auto shrink-0 text-xs ${topic.fit === "strong" ? "text-emerald-700 dark:text-emerald-400" : "text-black/40 dark:text-white/40"}`}>{topic.fit === "strong" ? "Strong fit" : "Partial fit"}</span>
						</p>
						<p className="text-xs text-black/40 dark:text-white/40">{topicPath(topic.path).join(" › ")}</p>
						<p className="mt-0.5 text-xs leading-5 text-black/55 dark:text-white/55">{topic.reason}</p>
					</div>
				</li>
			))}
		</ul>
	);
}

function DetailSection({ aside, children, title }: { aside?: ReactNode; children: ReactNode; title: string }) {
	return (
		<section>
			<div className="mb-2.5 flex h-6 items-center gap-2">
				<h4 className="text-sm font-medium text-black/85 dark:text-white/85">{title}</h4>
				{aside ? <span className="ms-auto text-xs tabular-nums text-black/45 dark:text-white/45">{aside}</span> : null}
			</div>
			{children}
		</section>
	);
}

function MetadataLine({ payload }: { payload: Record<string, unknown> }) {
	const text = (field: string) => (typeof payload[field] === "string" && payload[field] ? (payload[field] as string) : null);
	const doi = text("DOI");
	const items = [
		{ icon: Building03Icon, label: "Published by", value: text("publicationTitle") ?? text("proceedingsTitle") ?? text("publisher") ?? text("institution") },
		{ icon: Calendar03Icon, label: "Date", value: text("date") },
		{ icon: Globe02Icon, label: "Language", value: text("language")?.toUpperCase() ?? null },
	].filter((item) => item.value);
	if (!items.length && !doi) return null;
	return (
		<ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-black/60 dark:text-white/60">
			{items.map((item) => (
				<li className="flex min-w-0 items-center gap-1.5" key={item.label}>
					<HugeiconsIcon aria-label={item.label} className="shrink-0 text-black/35 dark:text-white/35" icon={item.icon} size={13} />
					<span className="truncate">{item.value}</span>
				</li>
			))}
			{doi ? (
				<li className="flex min-w-0 items-center gap-1.5">
					<HugeiconsIcon aria-label="DOI" className="shrink-0 text-black/35 dark:text-white/35" icon={Link01Icon} size={13} />
					<a className="truncate text-accent hover:underline" href={`https://doi.org/${doi}`} rel="noreferrer" target="_blank">
						{doi}
					</a>
				</li>
			) : null}
		</ul>
	);
}

function Abstract({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	return (
		<div>
			<p className={`text-sm leading-6 text-black/70 dark:text-white/70 ${open ? "" : "line-clamp-4"}`}>{text}</p>
			{text.length > 320 ? (
				<button className="mt-1 text-xs font-medium text-accent hover:underline" onClick={() => setOpen(!open)} type="button">
					{open ? "Show less" : "Show all"}
				</button>
			) : null}
		</div>
	);
}

function ReadingPlaceholder() {
	return (
		<div aria-hidden className="flex flex-col gap-2.5">
			{["w-11/12", "w-full", "w-4/5", "w-2/3"].map((width) => (
				<span className={`h-2.5 animate-pulse rounded-full bg-black/[0.06] dark:bg-white/[0.07] ${width}`} key={width} />
			))}
		</div>
	);
}

const PROPERTY_ROWS: { field: keyof PdfProperties; label: string }[] = [
	{ field: "title", label: "Title" },
	{ field: "authors", label: "Authors" },
	{ field: "subject", label: "Subject" },
	{ field: "keywords", label: "Keywords" },
	{ field: "rights", label: "Rights" },
	{ field: "doi", label: "DOI" },
];

const propertyText = (properties: PdfProperties, field: keyof PdfProperties) => {
	const value = properties[field];
	return Array.isArray(value) ? value.join(field === "authors" ? "; " : ", ") : value;
};

/**
 * What publishing writes into the PDF, beside what it carries now. Every
 * published PDF gets the record's properties; fixes reach the file through
 * Rights.
 */
function PdfPropertiesList({ after, now }: { after: PdfProperties; now: PdfPropertiesReading }) {
	if (!now.writable) {
		return (
			<p className="text-xs leading-5 text-black/55 dark:text-white/55">
				{now.reason === "password" ? "This PDF has a password" : "This PDF can't be opened for editing"}, so publishing leaves its properties as they are.
			</p>
		);
	}
	return (
		<dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-2.5">
			{PROPERTY_ROWS.map(({ field, label }) => {
				const value = propertyText(after, field);
				const before = propertyText(now.properties, field);
				return (
					<div className="contents" key={field}>
						<dt className="pt-px text-xs leading-5 text-black/45 dark:text-white/45">{label}</dt>
						<dd className="min-w-0 text-xs leading-5">
							<p className={`line-clamp-2 ${value ? "text-black/80 dark:text-white/80" : "text-black/40 dark:text-white/40"}`}>{value || (field === "doi" ? "Added when Zenodo allocates the DOI" : "Left empty")}</p>
							{before && before !== value ? <p className="line-clamp-1 text-black/40 line-through decoration-black/25 dark:text-white/40 dark:decoration-white/25">{before}</p> : null}
						</dd>
					</div>
				);
			})}
		</dl>
	);
}

/** The section's note: when the properties are written, and how many the file lacks now. */
function propertiesAside(after: PdfProperties, now: PdfPropertiesReading) {
	if (!now.writable) return undefined;
	const missing = PROPERTY_ROWS.filter(({ field }) => propertyText(after, field) && !propertyText(now.properties, field)).length;
	return missing ? `Written when published, ${missing} not in the file now` : "Written when published";
}

async function openWithProperties(file: File, properties: PdfProperties) {
	const { writePdfProperties } = await import("@/lib/admin/pdf-properties");
	const bytes = await writePdfProperties(new Uint8Array(await file.arrayBuffer()), properties);
	window.open(URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })), "_blank", "noopener");
}

export function ReviewDetail({
	attach,
	checks,
	chosenTopics,
	criteriaCount,
	locked,
	onFix,
	onOpenRecord,
	onToggleTopic,
	properties,
	result,
	row,
}: {
	attach: AttachState | undefined;
	checks: ReviewCheck[];
	chosenTopics: ReadonlySet<string>;
	criteriaCount: number;
	locked: boolean;
	onFix: (index: number) => void;
	onOpenRecord: (itemKey: string) => void;
	onToggleTopic: (topicId: string) => void;
	/** What publishing writes into the PDF. */
	properties: PdfProperties;
	result: AdminImportCommitResult | undefined;
	row: ImportRow;
}) {
	const record = row.record;
	const payload = record?.payload ?? {};
	const abstract = typeof payload.abstractNote === "string" ? payload.abstractNote : null;
	const settled = row.state === "read" || row.state === "failed";
	const passed = checks.filter((check) => check.fixed || check.result === "met").length;
	const openKey = result?.itemKey ?? record?.existingKey;
	const kindLine = [record?.itemType ? humanizeAdminField(record.itemType) : null, record?.year].filter(Boolean);
	const writable = row.pdf?.writable === true;
	return (
		<article className="flex flex-col gap-6">
			<header className="flex gap-4">
				<ImportCover className="w-[4.5rem]" file={row.file} itemType={record?.itemType} reading={row.state === "reading"} size={20} />
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<p className="flex h-4 gap-3 text-xs text-black/45 dark:text-white/45">
						{kindLine.map((part) => (
							<span key={String(part)}>{part}</span>
						))}
					</p>
					<h3 className={`line-clamp-3 text-base font-semibold leading-6 ${record?.title ? "text-black/90 dark:text-white/90" : "text-black/40 dark:text-white/40"}`}>{record?.title ?? row.file?.name ?? record?.source}</h3>
					{record?.creators.length ? <p className="line-clamp-2 text-sm text-black/60 dark:text-white/60">{record.creators.join(", ")}</p> : null}
					<div className="mt-1">
						<StatusText status={rowStatus(row, result, attach)} />
					</div>
					{record?.message && record.state !== "ready" ? <p className="text-xs text-black/55 dark:text-white/55">{record.message}</p> : null}
					{row.message ? <p className="text-xs text-danger">{row.message}</p> : null}
				</div>
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
					{row.topics.length ? (
						<DetailSection aside={`${chosenTopics.size} of ${row.topics.length} chosen`} title="Topics">
							<TopicList chosen={chosenTopics} locked={locked} onToggle={onToggleTopic} topics={row.topics} />
						</DetailSection>
					) : null}
					{row.file && criteriaCount ? (
						<DetailSection aside={`${passed} of ${criteriaCount} pass`} title="Checks">
							<CheckList checks={checks} locked={locked} onFix={onFix} />
						</DetailSection>
					) : null}
					{row.file && record && row.pdf ? (
						<DetailSection aside={propertiesAside(properties, row.pdf)} title="PDF properties">
							<PdfPropertiesList after={properties} now={row.pdf} />
						</DetailSection>
					) : null}
				</div>
			)}

			{row.file || openKey ? (
				<div className="flex flex-wrap gap-2">
					{row.file ? (
						<Button onPress={() => window.open(URL.createObjectURL(row.file!), "_blank", "noopener")} size="xs" startContent={<HugeiconsIcon aria-hidden icon={SquareArrowUpRight02Icon} size={14} />} variant="muted">
							Open PDF
						</Button>
					) : null}
					{row.file && record && writable ? (
						<Button onPress={() => void openWithProperties(row.file!, properties)} size="xs" startContent={<HugeiconsIcon aria-hidden icon={FileExportIcon} size={14} />} variant="muted">
							Open with new properties
						</Button>
					) : null}
					{openKey ? (
						<Button onPress={() => onOpenRecord(openKey)} size="xs" startContent={<HugeiconsIcon aria-hidden icon={ArrowRight01Icon} size={14} />} variant="muted">
							{result?.itemKey ? "Open the draft" : "Open the record"}
						</Button>
					) : null}
				</div>
			) : null}
		</article>
	);
}

const unchanging = () => () => undefined;

/** What the AI found in the PDF this draft was imported from: its topics and the library's checks. */
export function ImportReviewSection({ itemKey }: { itemKey: string }) {
	const stored = useSyncExternalStore(unchanging, () => storedReview(itemKey), () => null);
	const review = stored ? reviewFrom(stored) : null;
	if (!review) return null;
	return (
		<InspectorSection icon={CheckListIcon} id="admin-import-review" title="PDF review">
			<div className="flex flex-col gap-4">
				{review.abstractWritten ? <p className="text-xs text-black/55 dark:text-white/55">The AI wrote the abstract; the PDF has none.</p> : null}
				{review.topics.length ? <p className="text-sm text-black/70 dark:text-white/70">{review.topics.map(({ name }) => name).join(", ")}</p> : null}
				{review.checks.length ? <CheckList checks={review.checks} /> : null}
			</div>
		</InspectorSection>
	);
}
