"use client";

import {
	AlertCircleIcon,
	ArrowRight01Icon,
	CancelCircleIcon,
	CheckListIcon,
	CheckmarkCircle02Icon,
	Copy01Icon,
	HelpCircleIcon,
	Idea01Icon,
	SquareArrowUpRight02Icon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";
import { Spinner } from "@/components/nextui/Spinner";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import type { AdminImportCommitResult, PdfCheckResult, TopicSuggestion } from "@/lib/admin/item-import-contract";

import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import { InspectorSection } from "./InspectorSection";
import { humanizeAdminField } from "./admin-schema";
import { storedReview, topicPath, type ImportRow, type ReviewFilter, type StoredReview } from "./admin-import";
import type { ImportKind } from "./ImportRail";

const ROWS_PER_PAGE = 7;

export type AttachState = "attaching" | "attached" | "failed";

const resultLook: Record<PdfCheckResult["result"], { bar: string; icon: typeof Tick02Icon; label: string; tone: string; tint: string }> = {
	met: { bar: "bg-emerald-500", icon: CheckmarkCircle02Icon, label: "Met", tint: "bg-emerald-500/10", tone: "text-emerald-600 dark:text-emerald-400" },
	not_met: { bar: "bg-danger", icon: CancelCircleIcon, label: "Not met", tint: "bg-danger/10", tone: "text-danger" },
	unclear: { bar: "bg-amber-500", icon: HelpCircleIcon, label: "Unclear", tint: "bg-amber-500/10", tone: "text-amber-600 dark:text-amber-400" },
};

type Tone = "attention" | "neutral" | "progress" | "ready";
const toneClass: Record<Tone, string> = {
	attention: "text-amber-700 dark:text-amber-400",
	neutral: "text-black/50 dark:text-white/50",
	progress: "text-black/55 dark:text-white/55",
	ready: "text-emerald-700 dark:text-emerald-400",
};

/** What a row's status line says, from its reading, its preview, its import and its PDF. */
function rowStatus(row: ImportRow, result: AdminImportCommitResult | undefined, attach: AttachState | undefined): { label: string; tone: Tone; icon: typeof Tick02Icon | null } {
	if (row.state === "waiting") return { icon: null, label: "Queued", tone: "progress" };
	if (row.state === "reading") return { icon: null, label: "Reading", tone: "progress" };
	if (row.state === "failed" || !row.record) return { icon: AlertCircleIcon, label: "Could not read", tone: "attention" };
	if (result?.outcome === "failed") return { icon: AlertCircleIcon, label: "Not imported", tone: "attention" };
	if (attach === "attaching") return { icon: null, label: "Attaching the PDF", tone: "progress" };
	if (attach === "failed") return { icon: AlertCircleIcon, label: "Draft created, PDF not attached", tone: "attention" };
	if (result?.outcome === "created") return { icon: CheckmarkCircle02Icon, label: attach === "attached" ? "Draft created with its PDF" : "Draft created", tone: "ready" };
	const states = {
		attention: { icon: AlertCircleIcon, label: "Needs attention", tone: "attention" },
		existing: { icon: Copy01Icon, label: "Already in the library", tone: "neutral" },
		ready: { icon: Tick02Icon, label: "Ready", tone: "ready" },
		repeated: { icon: Copy01Icon, label: "Repeated in this import", tone: "neutral" },
		unresolved: { icon: AlertCircleIcon, label: "Not found", tone: "attention" },
	} as const;
	return states[row.record.state];
}

function StatusLine({ status }: { status: ReturnType<typeof rowStatus> }) {
	return (
		<span className={`flex min-w-0 items-center gap-1.5 text-xs font-medium ${toneClass[status.tone]}`}>
			{status.tone === "progress" ? <Spinner classNames={{ wrapper: "size-3" }} size="sm" /> : status.icon ? <HugeiconsIcon aria-hidden className="shrink-0" icon={status.icon} size={13} /> : null}
			<span className="truncate">{status.label}</span>
		</span>
	);
}

/** One small bar per check, coloured by its result; grey until the PDF is read. */
function CheckMeter({ checks, count }: { checks: PdfCheckResult[]; count: number }) {
	if (!count) return null;
	const met = checks.filter(({ result }) => result === "met").length;
	return (
		<span aria-label={checks.length ? `${met} of ${count} checks met` : `${count} checks`} className="flex items-center gap-1.5" role="img">
			<span className="flex gap-[3px]">
				{Array.from({ length: count }, (_, index) => (
					<span className={`h-3 w-[5px] rounded-full transition-colors duration-500 ${checks[index] ? resultLook[checks[index].result].bar : "bg-black/10 dark:bg-white/10"}`} key={index} />
				))}
			</span>
			<span className={`text-[11px] tabular-nums text-black/50 transition-opacity duration-300 dark:text-white/50 ${checks.length ? "" : "opacity-0"}`}>
				{met}/{count}
			</span>
		</span>
	);
}

function creatorsLine(creators: readonly string[]) {
	if (creators.length <= 2) return creators.join(" and ");
	return `${creators[0]} and ${creators.length - 1} more`;
}

const FILTERS: { filter: ReviewFilter; label: string; pdfOnly?: boolean; tone: string }[] = [
	{ filter: "all", label: "All", tone: "" },
	{ filter: "ready", label: "Ready", tone: "text-emerald-700 dark:text-emerald-400" },
	{ filter: "existing", label: "In the library", tone: "" },
	{ filter: "attention", label: "Needs attention", tone: "text-amber-700 dark:text-amber-400" },
	{ filter: "improve", label: "Checks to improve", pdfOnly: true, tone: "text-amber-700 dark:text-amber-400" },
];

export type ReviewCounts = Record<"attention" | "done" | "existing" | "improve" | "ready" | "total", number>;

/** Reading progress for PDFs, and the counts that also filter the list. */
export function SummaryStrip({ counts, filter, kind, onFilter }: { counts: ReviewCounts; filter: ReviewFilter; kind: ImportKind; onFilter: (filter: ReviewFilter) => void }) {
	const reading = kind === "pdfs" && counts.done < counts.total;
	const countOf = (key: ReviewFilter) => (key === "all" ? counts.total : counts[key]);
	return (
		<div className="flex flex-col gap-3">
			{kind === "pdfs" ? (
				<div className="flex items-center gap-3">
					<span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10">
						<span className="absolute inset-y-0 start-0 w-full origin-left rounded-full bg-accent transition-transform duration-700 ease-out motion-reduce:transition-none" style={{ transform: `scaleX(${counts.total ? counts.done / counts.total : 0})` }} />
					</span>
					<span className="w-28 text-end text-xs font-medium tabular-nums text-black/65 dark:text-white/65">
						{reading ? `${counts.done} of ${counts.total} read` : `All ${counts.total} read`}
					</span>
				</div>
			) : null}
			<div aria-label="Show" className="flex flex-wrap gap-1.5" role="group">
				{FILTERS.filter((option) => kind === "pdfs" || !option.pdfOnly).map((option) => {
					const active = filter === option.filter;
					const count = countOf(option.filter);
					return (
						<button
							aria-pressed={active}
							className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium outline-none transition-[background-color,box-shadow,color] duration-150 focus-visible:ring-2 focus-visible:ring-accent ${active ? "bg-white text-black/85 shadow-card-lifted ring-1 ring-black/[0.08] dark:bg-white/10 dark:text-white/90 dark:ring-white/10" : `bg-black/[0.035] hover:bg-black/[0.06] dark:bg-white/[0.05] dark:hover:bg-white/[0.08] ${count ? option.tone || "text-black/60 dark:text-white/60" : "text-black/35 dark:text-white/35"}`}`}
							key={option.filter}
							onClick={() => onFilter(option.filter)}
							type="button"
						>
							{option.label}
							<span className="tabular-nums opacity-70">{count}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

export function ReviewList({
	activeId,
	attach,
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
		<div className="flex min-h-0 flex-col">
			<div className="flex h-9 items-center gap-2.5 px-2.5 text-xs text-black/55 dark:text-white/55">
				<Checkbox
					aria-label="Choose every ready record"
					isDisabled={locked || !readyIds.length}
					isIndeterminate={selected.size > 0 && !all}
					isSelected={all}
					onValueChange={(checked) => onSelectedChange(new Set(checked ? readyIds : []))}
					size="sm"
				/>
				<span className="tabular-nums">
					{selected.size} of {readyIds.length} ready chosen
				</span>
			</div>
			<ul className="flex flex-col gap-1">
				{items.map((row) => {
					const active = row.id === activeId;
					const status = rowStatus(row, resultById.get(row.id), attach.get(row.id));
					const title = row.record?.title ?? row.file?.name ?? row.record?.source ?? "";
					return (
						<li
							className={`group/row flex h-[4.5rem] items-center gap-2.5 rounded-xl px-2.5 transition-[background-color,box-shadow] duration-200 ${active ? "bg-white shadow-card-lifted ring-1 ring-black/[0.06] dark:bg-white/[0.07] dark:ring-white/10" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"}`}
							key={row.id}
						>
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
							<button aria-current={active || undefined} className="flex min-w-0 flex-1 items-center gap-3 self-stretch text-start outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg" onClick={() => onActivate(row.id)} type="button">
								<ImportCover className="w-9" file={row.file} itemType={row.record?.itemType} reading={row.state === "reading"} size={14} />
								<span className="min-w-0 flex-1">
									<span className={`block truncate text-[13px] font-medium ${row.record?.title ? "text-black/85 dark:text-white/85" : "text-black/45 dark:text-white/45"}`}>{title}</span>
									{row.state === "reading" || row.state === "waiting" ? (
										<span aria-hidden className="my-1 block h-2.5 w-2/3 animate-pulse rounded-full bg-black/[0.06] dark:bg-white/[0.07]" />
									) : (
										<span className="block truncate text-xs text-black/50 dark:text-white/50">
											{row.record ? [creatorsLine(row.record.creators), row.record.year].filter(Boolean).join(", ") || " " : " "}
										</span>
									)}
									<span className="mt-1 flex items-center justify-between gap-2">
										<StatusLine status={status} />
										<CheckMeter checks={row.checks} count={row.file ? criteriaCount : 0} />
									</span>
								</span>
							</button>
						</li>
					);
				})}
				{!items.length ? <li className="flex h-24 items-center justify-center text-sm text-black/45 dark:text-white/45">Nothing here</li> : null}
			</ul>
			<ImportPager label="Pages of records" onChange={(page) => setPageByFilter((value) => ({ ...value, [filter]: page }))} page={current} pages={pages} perPage={ROWS_PER_PAGE} total={rows.length} />
		</div>
	);
}

function CheckList({ checks }: { checks: PdfCheckResult[] }) {
	return (
		<ul className="flex flex-col gap-4">
			{checks.map((check) => {
				const look = resultLook[check.result];
				return (
					<li className="flex gap-3" key={check.criterion}>
						<span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${look.tint} ${look.tone}`}>
							<HugeiconsIcon aria-label={look.label} icon={look.icon} size={15} />
						</span>
						<div className="min-w-0 flex-1 text-[13px] leading-5">
							<p className="pt-1 font-medium text-black/85 dark:text-white/85">{check.criterion}</p>
							{check.quote ? (
								<p className="mt-1.5 rounded-lg bg-black/[0.035] px-3 py-2 text-xs leading-5 text-black/65 dark:bg-white/[0.05] dark:text-white/65">
									<q>{check.quote}</q>
									{check.page ? <span className="ms-2 whitespace-nowrap rounded-md bg-white px-1.5 py-px text-[11px] font-medium tabular-nums text-black/55 ring-1 ring-black/[0.06] dark:bg-white/10 dark:text-white/60 dark:ring-white/10">Page {check.page}</span> : null}
								</p>
							) : null}
							{check.recommendation ? (
								<p className="mt-1.5 flex gap-2 rounded-lg bg-amber-500/[0.08] px-3 py-2 text-xs leading-5 text-amber-900 dark:text-amber-200">
									<HugeiconsIcon aria-hidden className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" icon={Idea01Icon} size={13} />
									{check.recommendation}
								</p>
							) : null}
						</div>
					</li>
				);
			})}
		</ul>
	);
}

function TopicList({ chosen, locked, onToggle, topics }: { chosen: ReadonlySet<string>; locked: boolean; onToggle: (id: string) => void; topics: TopicSuggestion[] }) {
	return (
		<ul className="flex flex-col gap-1.5">
			{topics.map((topic) => {
				const on = chosen.has(topic.id);
				return (
					<li key={topic.id}>
						<button
							aria-pressed={on}
							className={`flex w-full gap-3 rounded-xl px-3 py-2.5 text-start outline-none ring-1 transition-[background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default ${on ? "bg-accent/[0.06] ring-accent/35" : "bg-white ring-black/[0.08] hover:bg-black/[0.02] dark:bg-white/[0.03] dark:ring-white/10"}`}
							disabled={locked}
							onClick={() => onToggle(topic.id)}
							type="button"
						>
							<span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] transition-colors duration-150 ${on ? "bg-accent text-white" : "ring-1 ring-inset ring-black/25 dark:ring-white/25"}`}>
								{on ? <HugeiconsIcon aria-hidden icon={Tick02Icon} size={11} strokeWidth={2.6} /> : null}
							</span>
							<span className="min-w-0 flex-1">
								<span className="flex items-center gap-2">
									<span className="text-[13px] font-medium text-black/85 dark:text-white/85">{topic.name}</span>
									<span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${topic.fit === "strong" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-black/[0.05] text-black/50 dark:bg-white/[0.07] dark:text-white/50"}`}>
										{topic.fit === "strong" ? "Strong fit" : "Partial fit"}
									</span>
								</span>
								<span className="block text-[11px] text-black/45 dark:text-white/45">{topicPath(topic.path).join(" › ")}</span>
								<span className="mt-1 block text-xs text-black/60 dark:text-white/60">{topic.reason}</span>
							</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}

function DetailSection({ aside, children, title }: { aside?: ReactNode; children: ReactNode; title: string }) {
	return (
		<section className="border-t border-black/[0.06] pt-5 dark:border-white/[0.06]">
			<div className="mb-3 flex items-center gap-3">
				<h4 className="text-[13px] font-semibold text-black/80 dark:text-white/80">{title}</h4>
				{aside}
			</div>
			{children}
		</section>
	);
}

function Chips({ payload }: { payload: Record<string, unknown> }) {
	const text = (field: string) => (typeof payload[field] === "string" && payload[field] ? (payload[field] as string) : null);
	const chips = [text("publicationTitle") ?? text("proceedingsTitle"), text("publisher") ?? text("institution"), text("date"), text("language")?.toUpperCase(), text("pages") ? `${text("pages")} pages` : null].filter((chip): chip is string => Boolean(chip));
	const doi = text("DOI");
	return (
		<div className="flex flex-wrap gap-1.5">
			{chips.map((chip) => (
				<span className="max-w-full truncate rounded-md bg-black/[0.045] px-2 py-0.5 text-xs text-black/65 dark:bg-white/[0.07] dark:text-white/65" key={chip}>
					{chip}
				</span>
			))}
			{doi ? (
				<a className="flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent hover:bg-accent/15" href={`https://doi.org/${doi}`} rel="noreferrer" target="_blank">
					{doi}
					<HugeiconsIcon aria-hidden icon={SquareArrowUpRight02Icon} size={11} />
				</a>
			) : null}
		</div>
	);
}

function Abstract({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	return (
		<div>
			<p className={`text-[13px] leading-6 text-black/70 dark:text-white/70 ${open ? "" : "line-clamp-4"}`}>{text}</p>
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
				<span className={`h-3 animate-pulse rounded-full bg-black/[0.06] dark:bg-white/[0.07] ${width}`} key={width} />
			))}
		</div>
	);
}

export function ReviewDetail({
	attach,
	chosenTopics,
	criteriaCount,
	locked,
	onOpenRecord,
	onToggleTopic,
	result,
	row,
}: {
	attach: AttachState | undefined;
	chosenTopics: ReadonlySet<string>;
	criteriaCount: number;
	locked: boolean;
	onOpenRecord: (itemKey: string) => void;
	onToggleTopic: (topicId: string) => void;
	result: AdminImportCommitResult | undefined;
	row: ImportRow;
}) {
	const record = row.record;
	const payload = record?.payload ?? {};
	const abstract = typeof payload.abstractNote === "string" ? payload.abstractNote : null;
	const settled = row.state === "read" || row.state === "failed";
	const status = rowStatus(row, result, attach);
	const met = row.checks.filter(({ result: answer }) => answer === "met").length;
	const openKey = result?.itemKey ?? record?.existingKey;
	return (
		<article className="flex flex-col gap-5">
			<header className="flex gap-5">
				<ImportCover className="w-28" file={row.file} itemType={record?.itemType} reading={row.state === "reading"} size={26} />
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<div className="flex min-h-5 flex-wrap items-center gap-1.5 text-[11px] font-medium text-black/55 dark:text-white/55">
						{record?.itemType ? <span className="rounded-md bg-black/[0.05] px-1.5 py-0.5 dark:bg-white/[0.07]">{humanizeAdminField(record.itemType)}</span> : null}
						{record?.year ? <span className="rounded-md bg-black/[0.05] px-1.5 py-0.5 tabular-nums dark:bg-white/[0.07]">{record.year}</span> : null}
					</div>
					<h3 className={`line-clamp-3 text-lg font-semibold leading-snug tracking-tight ${record?.title ? "text-black/90 dark:text-white/90" : "text-black/40 dark:text-white/40"}`}>
						{record?.title ?? row.file?.name ?? record?.source}
					</h3>
					{record?.creators.length ? <p className="line-clamp-2 text-[13px] text-black/60 dark:text-white/60">{record.creators.join(", ")}</p> : null}
					<StatusLine status={status} />
					{record?.message && record.state !== "ready" ? <p className="text-xs text-black/55 dark:text-white/55">{record.message}</p> : null}
					{row.message ? <p className="text-xs text-danger">{row.message}</p> : null}
				</div>
			</header>

			{!settled ? (
				<ReadingPlaceholder />
			) : (
				<div className="flex animate-fade-in flex-col gap-5 [animation-duration:300ms]">
					{record ? <Chips payload={payload} /> : null}
					{abstract ? (
						<DetailSection title="Abstract">
							<Abstract text={abstract} />
						</DetailSection>
					) : row.file && record ? (
						<p className="text-xs text-black/45 dark:text-white/45">The PDF has no abstract</p>
					) : null}
					{row.topics.length ? (
						<DetailSection aside={<span className="text-xs tabular-nums text-black/45 dark:text-white/45">{chosenTopics.size} chosen</span>} title="Topics">
							<TopicList chosen={chosenTopics} locked={locked} onToggle={onToggleTopic} topics={row.topics} />
						</DetailSection>
					) : null}
					{row.file && criteriaCount ? (
						<DetailSection aside={<CheckMeter checks={row.checks} count={criteriaCount} />} title={`Checks, ${met} of ${criteriaCount} met`}>
							<CheckList checks={row.checks} />
						</DetailSection>
					) : null}
				</div>
			)}

			{row.file || openKey ? (
				<div className="flex flex-wrap gap-2 border-t border-black/[0.06] pt-4 dark:border-white/[0.06]">
					{row.file ? (
						<Button onPress={() => window.open(URL.createObjectURL(row.file!), "_blank", "noopener")} size="xs" startContent={<HugeiconsIcon aria-hidden icon={SquareArrowUpRight02Icon} size={14} />} variant="muted">
							Open PDF
						</Button>
					) : null}
					{openKey ? (
						<Button onPress={() => onOpenRecord(openKey)} size="xs" startContent={<HugeiconsIcon aria-hidden icon={ArrowRight01Icon} size={14} />} variant="muted">
							{result?.itemKey ? "Open the draft" : "Open the record in the library"}
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
	if (!stored) return null;
	const review = JSON.parse(stored) as StoredReview;
	return (
		<InspectorSection icon={CheckListIcon} id="admin-import-review" title="PDF review">
			<div className="flex flex-col gap-5">
				{review.topics.length ? (
					<div className="flex flex-wrap gap-1.5">
						{review.topics.map((topic) => (
							<span className="rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent" key={topic.id}>
								<TruncatedText text={topic.name} />
							</span>
						))}
					</div>
				) : null}
				{review.checks.length ? <CheckList checks={review.checks} /> : null}
			</div>
		</InspectorSection>
	);
}
