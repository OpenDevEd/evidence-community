"use client";

import {
	AlertCircleIcon,
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
	MinusSignIcon,
	PencilEdit02Icon,
	PlusSignIcon,
	Tick02Icon,
	CopyrightIcon,
	Undo02Icon,
} from "@hugeicons/core-free-icons";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";
import type { AdminImportCommitResult, PdfCheckResult, RightsFix, TopicSuggestion } from "@/lib/admin/item-import-contract";
import type { PdfProperties, PdfPropertiesReading } from "@/lib/admin/pdf-properties";

import type { ImportKind } from "./ImportSteps";
import { InspectorSection } from "./InspectorSection";
import { checkPasses, reviewFrom, storedReview, topicPath, type AttachState, type ImportRow, type ReviewCheck, type ReviewFilter } from "./admin-import";

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
export function rowStatus(row: ImportRow, result: AdminImportCommitResult | undefined, attach: AttachState | undefined): Status {
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

export function StatusText({ status }: { status: Status }) {
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
export function CheckMeter({ checks, count }: { checks: ReviewCheck[]; count: number }) {
	if (!count) return null;
	const passed = checks.filter(checkPasses).length;
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

export function creatorsLine(creators: readonly string[]) {
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

/** The filters, each with its count. */
export function ReviewBar({ counts, filter, kind, onFilter }: { counts: ReviewCounts; filter: ReviewFilter; kind: ImportKind; onFilter: (filter: ReviewFilter) => void }) {
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
		</div>
	);
}

/** The answer to each check, and for a failed one that the Rights fix covers, whether it is applied. */
function CheckList({ checks }: { checks: ReviewCheck[] }) {
	return (
		<ul className="flex flex-col gap-4">
			{checks.map((check) => {
				const look = lookOf(check);
				return (
					<li className="flex gap-2.5" key={check.criterion}>
						<HugeiconsIcon aria-label={look.label} className={`mt-0.5 shrink-0 ${look.tone}`} icon={look.icon} size={16} />
						<div className="min-w-0 flex-1 text-sm">
							<p className="text-black/85 dark:text-white/85">{check.criterion}</p>
							{check.quote ? (
								<p className="mt-1 text-xs leading-5 text-black/55 dark:text-white/55">
									{check.file ? check.quote : <q>{check.quote}</q>}
									{check.page ? <span className="ms-1.5 whitespace-nowrap tabular-nums text-black/40 dark:text-white/40">p. {check.page}</span> : null}
								</p>
							) : null}
							{check.recommendation ? (
								<p className="mt-1 flex gap-1.5 text-xs leading-5 text-amber-800 dark:text-amber-300">
									<HugeiconsIcon aria-hidden className="mt-[3px] shrink-0" icon={Idea01Icon} size={12} />
									{check.recommendation}
								</p>
							) : null}
							{check.fixable ? (
								<p className="mt-1 flex gap-1.5 text-xs leading-5 text-black/55 dark:text-white/55">
									<HugeiconsIcon aria-hidden className="mt-[3px] shrink-0" icon={CopyrightIcon} size={12} />
									{check.fixed ? "Fixed by the new Rights" : "The suggested Rights below fixes this"}
								</p>
							) : null}
						</div>
					</li>
				);
			})}
		</ul>
	);
}

/** The library's checks, then the ones read from the file itself, with what goes between them. */
export function Checks({ checks, children }: { checks: ReviewCheck[]; children?: ReactNode }) {
	const file = checks.filter((check) => check.file);
	return (
		<>
			<CheckList checks={checks.filter((check) => !check.file)} />
			{children}
			{file.length ? (
				<>
					<p className="mb-2.5 mt-5 text-xs text-black/45 dark:text-white/45">From the file itself</p>
					<CheckList checks={file} />
				</>
			) : null}
		</>
	);
}

/** The Rights statement the AI suggests so the failed rights checks pass, beside what the PDF says now. */
export function RightsFixLine({ applied, fix, locked, onToggle, stated }: { applied: boolean; fix: RightsFix; locked: boolean; onToggle: () => void; stated: string }) {
	return (
		<div className="mt-5 flex items-start gap-2.5">
			<HugeiconsIcon aria-hidden className="mt-0.5 shrink-0 text-black/40 dark:text-white/40" icon={CopyrightIcon} size={16} />
			<div className="min-w-0 flex-1 text-sm">
				<p className="text-black/85 dark:text-white/85">{applied ? "Rights changed" : "Suggested Rights"}</p>
				<p className="mt-1 text-xs leading-5 text-black/70 dark:text-white/70">
					<q>{fix.statement}</q>
				</p>
				{stated ? (
					<p className="mt-1 text-xs leading-5 text-black/45 dark:text-white/45">
						The PDF says <q>{stated}</q>
					</p>
				) : null}
			</div>
			<Button className="h-8 min-h-8 min-w-[4.5rem] shrink-0" isDisabled={locked} onPress={onToggle} size="xs" startContent={<HugeiconsIcon aria-hidden icon={applied ? Undo02Icon : Tick02Icon} size={13} />} variant={applied ? "transparent" : "muted"}>
				{applied ? "Undo" : "Apply"}
			</Button>
		</div>
	);
}

export function TopicList({ chosen, locked, onToggle, topics }: { chosen: ReadonlySet<string>; locked: boolean; onToggle: (id: string) => void; topics: TopicSuggestion[] }) {
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

export function DetailSection({ aside, children, title }: { aside?: ReactNode; children: ReactNode; title: string }) {
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

export function MetadataLine({ payload }: { payload: Record<string, unknown> }) {
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

export function Abstract({ text }: { text: string }) {
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

export function ReadingPlaceholder() {
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

type PropertyChange = "added" | "changed" | "removed";

const changeLook: Record<PropertyChange, { icon: typeof Tick02Icon; label: string; tone: string }> = {
	added: { icon: PlusSignIcon, label: "Added", tone: "text-emerald-700 dark:text-emerald-400" },
	changed: { icon: PencilEdit02Icon, label: "Changed", tone: "text-amber-700 dark:text-amber-400" },
	removed: { icon: MinusSignIcon, label: "Removed", tone: "text-black/50 dark:text-white/50" },
};

/** What publishing does to one property. A missing DOI isn't removed: Zenodo allocates one at publishing. */
function changeOf(field: keyof PdfProperties, after: PdfProperties, now: PdfProperties): PropertyChange | null {
	const value = propertyText(after, field) || (field === "doi" ? "pending" : "");
	const before = propertyText(now, field);
	if (value === before) return null;
	return !before ? "added" : value ? "changed" : "removed";
}

/**
 * What publishing writes into the PDF, beside what it carries now, each
 * property marked added, changed or removed. Every published PDF gets the
 * record's properties; fixes reach the file through Rights.
 */
export function PdfPropertiesList({ after, now }: { after: PdfProperties; now: PdfPropertiesReading }) {
	if (!now.writable) {
		return (
			<p className="text-xs leading-5 text-black/55 dark:text-white/55">
				{now.reason === "password" ? "This PDF has a password" : "This PDF can't be opened for editing"}, so publishing leaves its properties as they are.
			</p>
		);
	}
	return (
		<dl className="grid grid-cols-[4.5rem_minmax(0,1fr)_5rem] gap-x-4 gap-y-2.5">
			{PROPERTY_ROWS.map(({ field, label }) => {
				const value = propertyText(after, field);
				const before = propertyText(now.properties, field);
				const change = changeOf(field, after, now.properties);
				const look = change ? changeLook[change] : null;
				const shown = value || (field === "doi" ? "From Zenodo when published" : "Left empty");
				return (
					<div className="contents" key={field}>
						<dt className="pt-px text-xs leading-5 text-black/45 dark:text-white/45">{label}</dt>
						<dd className="min-w-0 text-xs leading-5">
							<p className={`line-clamp-2 ${value ? "text-black/80 dark:text-white/80" : "text-black/40 dark:text-white/40"}`}>{change === "added" || change === "changed" ? <ins className="no-underline">{shown}</ins> : shown}</p>
							{change === "changed" || change === "removed" ? (
								<p className="line-clamp-1 text-black/40 dark:text-white/40">
									<del className="decoration-black/25 dark:decoration-white/25">{before}</del>
								</p>
							) : null}
						</dd>
						<dd className={`flex h-5 items-center justify-end gap-1 text-xs ${look?.tone ?? ""}`}>
							{look ? (
								<>
									<HugeiconsIcon aria-hidden className="shrink-0" icon={look.icon} size={12} />
									{look.label}
								</>
							) : null}
						</dd>
					</div>
				);
			})}
		</dl>
	);
}

/** The section's note: what publishing does to the file's properties, in the marks the rows carry. */
export function propertiesAside(after: PdfProperties, now: PdfPropertiesReading) {
	if (!now.writable) return undefined;
	const changes = PROPERTY_ROWS.map(({ field }) => changeOf(field, after, now.properties));
	const count = (change: PropertyChange) => changes.filter((value) => value === change).length;
	const verbs = { added: "adds", changed: "changes", removed: "removes" } as const;
	const parts = (["added", "changed", "removed"] as const).filter((change) => count(change)).map((change) => `${verbs[change]} ${count(change)}`);
	return parts.length ? `Publishing ${parts.join(", ")}` : "Already in the file";
}

export async function openWithProperties(file: File, properties: PdfProperties) {
	const { writePdfProperties } = await import("@/lib/admin/pdf-properties");
	const bytes = await writePdfProperties(new Uint8Array(await file.arrayBuffer()), properties);
	window.open(URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })), "_blank", "noopener");
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
				{review.abstractWritten ? <p className="text-xs text-black/55 dark:text-white/55">The AI wrote the abstract.</p> : null}
				{review.topics.length ? <p className="text-sm text-black/70 dark:text-white/70">{review.topics.map(({ name }) => name).join(", ")}</p> : null}
				{review.checks.length ? (
					<div>
						<Checks checks={review.checks} />
					</div>
				) : null}
			</div>
		</InspectorSection>
	);
}
