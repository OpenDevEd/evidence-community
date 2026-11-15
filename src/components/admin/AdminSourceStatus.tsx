"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	AlertCircleIcon,
	ArrowDown01Icon,
	Cancel01Icon,
	CheckmarkCircle02Icon,
	Clock01Icon,
	ComputerIcon,
	Database01Icon,
	FileMinusIcon,
	Globe02Icon,
	HelpCircleIcon,
	Loading03Icon,
	MoreHorizontalIcon,
	PencilEdit02Icon,
	Pdf01Icon,
	Search01Icon,
	Settings02Icon,
	TextIcon,
	Tick01Icon,
} from "@hugeicons/core-free-icons";
import {
	DropdownItem,
	DropdownMenu,
	DropdownTrigger,
	ModalContent,
	ModalHeader,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@nextui-org/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { siZotero } from "simple-icons";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";

import BrandIcon from "@/components/icons/BrandIcon";
import { OpenAlexIcon } from "@/components/icons/OpenAlexIcon";
import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Dropdown } from "@/components/nextui/Dropdown";
import { Pagination } from "@/components/nextui/Pagination";
import { Progress } from "@/components/nextui/Progress";
import { Tooltip } from "@/components/nextui/Tooltip";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { sourceProviderName } from "@/lib/admin/source-label";
import type {
	AdminSource,
	AdminSourceIssue,
	AdminSourceIssueKind,
	AdminSourceIssueLink,
	AdminSourceIssuePage,
	AdminSourceIssueType,
} from "@/lib/admin/types";
import type { PdfCounts, SourceStatus } from "@/lib/source-ingestion/source-status";

import {
	dismissAdminSourceIssues,
	getAdminSourceIssuePage,
	getAdminSourceIssueTypes,
	restoreAdminSourceIssues,
} from "./admin-api";
import { SourceProviderIcon } from "./SourceProviderIcon";

// One locale for the server and every browser: the sidebar's badges are drawn with the page, and the two must write a number the same way.
const count = (value: number) => value.toLocaleString("en-GB");

const ISSUES_POLL_MS = 10_000;

/* Times, as the admin reads them */

const clock = (date: Date) => date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function daysBetween(date: Date, now: Date) {
	const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
	return Math.round((day(now) - day(date)) / 86_400_000);
}

/** "at 12:04", "yesterday at 18:10" or "on 3 Sep at 09:30". */
function when(iso: string, now: Date) {
	const date = new Date(iso);
	const days = daysBetween(date, now);
	if (days === 0) return `at ${clock(date)}`;
	if (days === 1) return `yesterday at ${clock(date)}`;
	return `on ${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} at ${clock(date)}`;
}

function ago(iso: string, now: Date) {
	const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	return when(iso, now);
}

/* Activity: where the source stands */

type Failure = Extract<SourceStatus, { state: "failed" }>["failure"];

/** What a failure means and what to do, with the provider's name filled in. */
const FAILURE_MESSAGES: Record<Failure["code"], (name: string) => string> = {
	access_denied: (name) => `${name} refused the saved key. Update it in the community's configuration.`,
	owner_left: () => "The person who added this collection left the organisation, so its records were withdrawn. Remove the source in the community's configuration.",
	not_found: (name) => `${name} no longer finds this source, or the saved key cannot see it.`,
	missing_key: () => "No API key is saved for this source. Add one in the community's configuration.",
	invalid_query: (name) => `${name} rejected the search. Edit it in the community's configuration.`,
	too_large: () => "This source has more records than the community allows.",
	rate_limited: (name) => `${name} is limiting requests. The import tries again every minute.`,
	unavailable: (name) => `${name} could not be reached. The import tries again every minute.`,
	interrupted: () => "The import stopped before it finished. It starts again on its own.",
	internal: () => "The import hit an unexpected error. The technical details show what happened.",
};

/** A paused source never runs, so a failure that would retry on its own waits for it to resume. */
const RETRIES_ON_ITS_OWN = new Set<Failure["code"]>(["rate_limited", "unavailable", "interrupted"]);
const PAUSED_MESSAGE = "The source is paused, so the import does not try again. Resume it in the community's configuration.";

type PhaseState = "running" | "done" | "failed" | "waiting";

const PHASE_LOOK: Record<PhaseState, { text: string; ring: string }> = {
	running: { text: "text-accent", ring: "bg-accent/10" },
	done: { text: "text-emerald-700 dark:text-emerald-400", ring: "bg-emerald-500/10 dark:bg-emerald-400/15" },
	failed: { text: "text-rose-700 dark:text-rose-300", ring: "bg-rose-500/10 dark:bg-rose-400/15" },
	waiting: { text: "text-black/40 dark:text-white/40", ring: "bg-black/[0.04] dark:bg-white/[0.07]" },
};

function Phase({ label, icon, state }: { label: string; icon: typeof Database01Icon; state: PhaseState }) {
	const look = PHASE_LOOK[state];
	return (
		<span className={`inline-flex items-center gap-1.5 text-xs font-medium ${look.text}`}>
			<span className={`grid size-6 place-items-center rounded-full ${look.ring}`}>
				<HugeiconsIcon
					aria-hidden
					icon={state === "running" ? Loading03Icon : state === "done" ? Tick01Icon : state === "failed" ? AlertCircleIcon : icon}
					size={13}
					className={state === "running" ? "animate-spin motion-reduce:animate-none" : undefined}
				/>
			</span>
			{label}
		</span>
	);
}

const PHASE_ORDER = ["import", "search", "pdfs"] as const;

/** Import records, update search, then add PDFs: the steps before the current one are done. */
function phaseStates(activity: SourceStatus): [PhaseState, PhaseState, PhaseState] {
	if (activity.state === "running") {
		const current = PHASE_ORDER.indexOf(activity.phase);
		return PHASE_ORDER.map((_, step) =>
			step < current ? "done" : step === current ? "running" : "waiting",
		) as [PhaseState, PhaseState, PhaseState];
	}
	// Search updates that failed show on the search step; a failed import never reached it.
	const search: PhaseState = activity.searchFailed > 0 ? "failed" : "waiting";
	if (activity.state === "succeeded") return ["done", search === "failed" ? "failed" : "done", "done"];
	if (activity.state === "failed") {
		return activity.failedIn === "pdfs"
			? ["done", search === "failed" ? "failed" : "done", "failed"]
			: ["failed", search, "waiting"];
	}
	return ["waiting", "waiting", "waiting"];
}

function Connector({ lit }: { lit: boolean }) {
	return (
		<span
			aria-hidden
			className={`h-px min-w-4 flex-1 transition-colors duration-500 motion-reduce:transition-none ${lit ? "bg-emerald-500/50" : "bg-black/10 dark:bg-white/10"}`}
		/>
	);
}

/** Records whose search update failed; they wait for a retry from the header. */
function SearchFailed({ activity }: { activity: SourceStatus }) {
	if (activity.searchFailed === 0) return null;
	return (
		<p className="flex items-center gap-1.5 text-xs text-rose-700 dark:text-rose-300">
			<HugeiconsIcon aria-hidden icon={AlertCircleIcon} size={14} className="shrink-0" />
			{count(activity.searchFailed)} {activity.searchFailed === 1 ? "record" : "records"} could not be added to search. Retry
			from search indexing in the header.
		</p>
	);
}

/** The phases of an import, with the one under way lit. Add PDFs shows for a source that adds them. */
function PhaseTrack({ activity }: { activity: SourceStatus }) {
	const [importState, searchState, pdfState] = phaseStates(activity);
	return (
		<div className="flex items-center gap-2">
			<Phase label="Import records" icon={Database01Icon} state={importState} />
			<Connector lit={importState === "done"} />
			<Phase label="Update search" icon={Search01Icon} state={searchState} />
			{activity.pdfs ? (
				<>
					<Connector lit={searchState === "done"} />
					<Phase label="Add PDFs" icon={Pdf01Icon} state={pdfState} />
				</>
			) : null}
		</div>
	);
}

const SEGMENT = "h-full transition-all duration-700 ease-out motion-reduce:transition-none";

/** PDFs added, then PDFs that could not be downloaded, along the PDFs to go through. */
function PdfBar({ pdfs, total, label, tone }: { pdfs: PdfCounts; total: number; label: string; tone: "running" | "done" }) {
	const share = (value: number) => `${total ? Math.min((value / total) * 100, 100) : 0}%`;
	return (
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={total}
			aria-valuenow={pdfs.added + pdfs.missed}
			className="flex h-2.5 w-full overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.1]"
		>
			<span className={`${SEGMENT} ${tone === "running" ? "bg-accent" : "bg-emerald-500"}`} style={{ width: share(pdfs.added) }} />
			<span className={`${SEGMENT} bg-black/25 dark:bg-white/25`} style={{ width: share(pdfs.missed) }} />
		</div>
	);
}

function PdfLegend({ pdfs, tone }: { pdfs: PdfCounts; tone: "running" | "done" }) {
	return (
		<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
			<span className="inline-flex items-center gap-1">
				<HugeiconsIcon
					aria-hidden
					icon={Pdf01Icon}
					size={13}
					className={tone === "running" ? "text-accent" : "text-emerald-600 dark:text-emerald-400"}
				/>
				{count(pdfs.added)} added
			</span>
			{pdfs.missed ? (
				<span className="inline-flex items-center gap-1">
					<HugeiconsIcon aria-hidden icon={FileMinusIcon} size={13} />
					{count(pdfs.missed)} could not be downloaded
				</span>
			) : null}
		</span>
	);
}

/** Time left, in hours once it runs past two. */
function timeLeft(minutes: number | null) {
	if (minutes === null) return null;
	if (minutes < 1) return "Under a minute left";
	return minutes >= 120 ? `${Math.round(minutes / 60)} h left` : `${Math.round(minutes)} min left`;
}

/** Moves a shown number toward its new value, so a change reads as progress. */
function useCountUp(value: number) {
	const [shown, setShown] = useState(value);
	const from = useRef(value);
	useEffect(() => {
		// Animation frames are a browser system; each frame sets the next figure.
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			from.current = value;
			const frame = requestAnimationFrame(() => setShown(value));
			return () => cancelAnimationFrame(frame);
		}
		const start = performance.now();
		const origin = from.current;
		let frame = 0;
		const step = (now: number) => {
			const t = Math.min((now - start) / 600, 1);
			const eased = 1 - (1 - t) ** 3;
			setShown(Math.round(origin + (value - origin) * eased));
			if (t < 1) frame = requestAnimationFrame(step);
			else from.current = value;
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	}, [value]);
	return shown;
}

/** The large figure that leads every state, with what it counts under it. */
function Headline({ value, unit }: { value: number; unit: string }) {
	const shown = useCountUp(value);
	return (
		<div>
			{/* Screen readers get the figure once, not every frame of its count. */}
			<p aria-hidden className="text-5xl font-semibold leading-none tracking-tighter tabular-nums">{count(shown)}</p>
			<span className="sr-only">{count(value)}</span>
			<p className="mt-1.5 text-sm text-black/55 dark:text-white/55">{unit}</p>
		</div>
	);
}

const RUNNING_UNIT = { import: "records", search: "records made searchable", pdfs: "PDFs" } as const;
const RUNNING_LABEL = { import: "Import progress", search: "Search update progress", pdfs: "PDF progress" } as const;

function RunningActivity({ activity }: { activity: Extract<SourceStatus, { state: "running" }> }) {
	const unit = RUNNING_UNIT[activity.phase];
	const fraction = activity.total ? Math.min(activity.done / activity.total, 1) : null;
	const pdfs = activity.phase === "pdfs" ? activity.pdfs : null;
	return (
		<div className="space-y-2.5">
			<Headline
				value={activity.done}
				unit={activity.total === null ? `${unit} so far` : `of ${count(activity.total)} ${unit}`}
			/>
			{pdfs && activity.total ? (
				<PdfBar pdfs={pdfs} total={activity.total} label={RUNNING_LABEL.pdfs} tone="running" />
			) : (
				<Progress
					aria-label={RUNNING_LABEL[activity.phase]}
					isIndeterminate={fraction === null}
					value={fraction === null ? undefined : fraction * 100}
					classNames={{
						track: "h-2.5 bg-black/[0.08] dark:bg-white/[0.1]",
						indicator: "duration-700 ease-out motion-reduce:transition-none",
					}}
				/>
			)}
			<div className="grid grid-cols-3 items-center text-[11px] tabular-nums text-black/55 dark:text-white/55">
				{pdfs ? <PdfLegend pdfs={pdfs} tone="running" /> : <span>Started {clock(new Date(activity.startedAt))}</span>}
				<span className="text-center text-xs font-semibold text-black/75 dark:text-white/80">
					{fraction === null ? null : `${Math.floor(fraction * 100)}%`}
				</span>
				<span className="text-right">{timeLeft(activity.minutesLeft)}</span>
			</div>
		</div>
	);
}

/** A finished source's PDFs: added, and those that could not be downloaded. */
function PdfSummary({ pdfs }: { pdfs: PdfCounts }) {
	const total = pdfs.added + pdfs.missed;
	if (!total) return null;
	return (
		<div className="space-y-2 text-[11px] tabular-nums text-black/55 dark:text-white/55">
			<PdfBar pdfs={pdfs} total={total} label="PDFs added" tone="done" />
			<PdfLegend pdfs={pdfs} tone="done" />
		</div>
	);
}

function FailedActivity({
	activity,
	configurationHref,
	paused,
	now,
}: {
	activity: Extract<SourceStatus, { state: "failed" }>;
	configurationHref: string | null;
	paused: boolean;
	now: Date;
}) {
	return (
		<div className="space-y-3">
			<div className="space-y-1.5">
				<p className="text-xl font-semibold leading-tight tracking-tight text-rose-700 dark:text-rose-300">
					{activity.failedIn === "pdfs" ? "PDFs stopped" : "Import failed"} {when(activity.failure.at, now)}
				</p>
				<p className="text-sm leading-relaxed text-black/70 dark:text-white/75">
					{paused && RETRIES_ON_ITS_OWN.has(activity.failure.code)
						? PAUSED_MESSAGE
						: FAILURE_MESSAGES[activity.failure.code](sourceProviderName(activity.provider))}
				</p>
				<p className="text-[11px] text-black/50 dark:text-white/50">
					{activity.failedIn === "pdfs"
						? "Every record stays searchable. Retrying carries on from the last PDF added."
						: activity.lastSuccessAt
							? `Last success ${when(activity.lastSuccessAt, now)}`
							: "No import has succeeded yet"}
				</p>
			</div>
			{activity.failedIn === "pdfs" && activity.pdfs ? <PdfSummary pdfs={activity.pdfs} /> : null}
			<TechnicalDetails details={activity.failure.details}>
				{configurationHref ? (
					<Button
						as="a"
						href={configurationHref}
						target="_blank"
						rel="noopener noreferrer"
						size="xs"
						color="accent"
						variant="solid"
						className="h-8 rounded-lg px-3"
						startContent={<HugeiconsIcon aria-hidden icon={Settings02Icon} size={14} />}
					>
						Open configuration
					</Button>
				) : null}
			</TechnicalDetails>
		</div>
	);
}

const BAND: Record<SourceStatus["state"], string> = {
	running: "bg-accent/[0.06]",
	succeeded: "bg-emerald-500/[0.06] dark:bg-emerald-400/[0.07]",
	failed: "bg-rose-500/[0.07] dark:bg-rose-400/[0.08]",
	idle: "",
};

/**
 * Where the source stands. One layout for every state: the phase track, then
 * one large figure or headline, then the line that explains it.
 */
function SourceActivityPanel({
	activity,
	configurationHref,
	paused,
}: {
	activity: SourceStatus;
	configurationHref: string | null;
	paused: boolean;
}) {
	const now = new Date();
	return (
		// A full-width band tinted by state, so the state reads before the words.
		<section
			aria-live="polite"
			className={`shrink-0 space-y-5 px-5 pb-6 pt-5 transition-colors sm:px-6 duration-300 motion-reduce:transition-none ${BAND[activity.state]}`}
		>
			<PhaseTrack activity={activity} />
			{activity.state === "running" ? <RunningActivity activity={activity} /> : null}
			{activity.state === "succeeded" ? (
				<div className="space-y-1.5">
					<Headline value={activity.searchable ?? 0} unit="records searchable" />
					<p className="text-[11px] text-black/50 dark:text-white/50">
						{activity.lastSuccessAt
							? activity.changed === null
								? `Checked ${ago(activity.lastSuccessAt, now)}`
								: `${count(activity.changed)} changed in the last import, checked ${ago(activity.lastSuccessAt, now)}`
							: null}
					</p>
					{activity.pdfs ? <PdfSummary pdfs={activity.pdfs} /> : null}
				</div>
			) : null}
			{activity.state === "failed" ? (
				<FailedActivity activity={activity} configurationHref={configurationHref} paused={paused} now={now} />
			) : null}
			<SearchFailed activity={activity} />
			{activity.state === "idle" ? (
				<div className="space-y-1.5">
					<p className="text-xl font-semibold leading-tight tracking-tight text-black/70 dark:text-white/75">
						Waiting for the first import
					</p>
					<p className="text-[11px] text-black/50 dark:text-white/50">Records appear here as soon as it starts.</p>
				</div>
			) : null}
		</section>
	);
}

/** The main action, with the raw error folded away beside it. */
function TechnicalDetails({ details, children }: { details: string; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-2">
				{children}
				<Button
					size="xs"
					variant="transparent"
					aria-expanded={open}
					className="h-8 rounded-lg px-2.5 text-black/55 dark:text-white/55"
					endContent={
						<HugeiconsIcon
							aria-hidden
							icon={ArrowDown01Icon}
							size={13}
							className={`transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
						/>
					}
					onPress={() => setOpen((value) => !value)}
				>
					Technical details
				</Button>
			</div>
			{open ? (
				<pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-black/55 dark:text-white/55">
					{details}
				</pre>
			) : null}
		</div>
	);
}

/* Record issues */

const KIND_ICON: Record<AdminSourceIssueKind, typeof Pdf01Icon> = {
	pdf: Pdf01Icon,
	fields: TextIcon,
	large: FileMinusIcon,
	other: AlertCircleIcon,
};

/** Height of one record row (h-11); a page holds as many as the list fits. */
const ROW_HEIGHT = 44;

/**
 * How many rows fit in the list right now, and how tall each is so a full
 * page fills it exactly. The list grows and shrinks with the window.
 */
function useRowsThatFit() {
	const ref = useRef<HTMLUListElement>(null);
	// Null until measured, so the first page asked for is the one that stays.
	const [fit, setFit] = useState<{ rows: number; height: number } | null>(null);
	useEffect(() => {
		// The list's height comes from the window, which only reaches React through this observer.
		const element = ref.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			const space = entry!.contentRect.height;
			const rows = Math.max(1, Math.floor(space / ROW_HEIGHT));
			setFit({ rows, height: Math.max(ROW_HEIGHT, space / rows) });
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return [ref, fit] as const;
}

/** One issue type in the rail: its icon, name and count. */
function IssueKindButton({
	group,
	selected,
	onSelect,
}: {
	group: AdminSourceIssueType;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onSelect}
			className={`flex w-full min-w-44 items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors motion-reduce:transition-none sm:min-w-0 ${
				selected ? "bg-accent/[0.085]" : "hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
			}`}
		>
			<HugeiconsIcon
				aria-hidden
				icon={KIND_ICON[group.kind]}
				size={17}
				className={`mt-0.5 shrink-0 self-start ${selected ? "text-accent" : "text-black/45 dark:text-white/50"}`}
			/>
			<span className="min-w-0 flex-1">
				<span className={`block truncate text-[13px] font-medium leading-5 ${selected ? "text-accent" : ""}`}>{group.title}</span>
				<span className="block text-[11px] leading-4 tabular-nums text-black/50 dark:text-white/50">
					{count(group.count)} {group.count === 1 ? "record" : "records"}
				</span>
			</span>
		</button>
	);
}

function IssueRecord({
	row,
	height,
	onOpenRecord,
	onDismiss,
}: {
	row: AdminSourceIssue;
	height: number;
	onOpenRecord: (itemKey: string) => void;
	onDismiss: (row: AdminSourceIssue) => void;
}) {
	const muted = !row.itemKey;
	const content = (
		<>
			<TruncatedText text={row.title} className={`text-[13px] font-medium leading-5 ${muted ? "text-black/55 dark:text-white/55" : ""}`} />
			<span className="flex min-w-0 items-center gap-2 text-[11px] leading-4 text-black/50 dark:text-white/50">
				<span className="truncate">{row.itemKey ? row.meta : "Not in the community"}</span>
				{row.detail ? (
					<Tooltip content={row.message}>
						<span className="min-w-0 max-w-[60%] shrink-0 truncate rounded bg-black/[0.05] px-1.5 font-medium text-black/65 dark:bg-white/[0.08] dark:text-white/70">
							{row.detail}
						</span>
					</Tooltip>
				) : null}
			</span>
		</>
	);
	return (
		<li
			className="group/row relative flex items-center gap-3 rounded-xl px-3 hover:bg-black/[0.035] dark:hover:bg-white/[0.045] [@media(hover:hover)]:hover:pr-[var(--actions)] [@media(hover:hover)]:focus-within:pr-[var(--actions)]"
			style={{ height, "--actions": `${actionsWidth(row)}px` } as CSSProperties}
		>
			{row.itemKey ? (
				<button
					type="button"
					onClick={() => onOpenRecord(row.itemKey!)}
					className="min-w-0 flex-1 text-left hover:[&_[data-truncated-text]]:text-accent"
				>
					{content}
				</button>
			) : (
				<span className="min-w-0 flex-1">
					{content}
				</span>
			)}
			<RowActions row={row} onOpenRecord={onOpenRecord} onDismiss={onDismiss} />
		</li>
	);
}

const LINK_LOOK: Record<AdminSourceIssueLink["kind"], { label: string; icon: ReactNode }> = {
	"zotero-app": { label: "Open in the Zotero app", icon: <HugeiconsIcon aria-hidden icon={ComputerIcon} size={15} /> },
	"zotero-web": { label: "Open on zotero.org", icon: <BrandIcon aria-hidden icon={siZotero} width={13} height={13} /> },
	openalex: { label: "Open on OpenAlex", icon: <OpenAlexIcon size={14} /> },
	public: { label: "Open public page", icon: <HugeiconsIcon aria-hidden icon={Globe02Icon} size={15} /> },
};

/** The Zotero app link hands off to the desktop app; everything else opens a tab. */
function linkTarget(link: AdminSourceIssueLink) {
	return link.kind === "zotero-app" ? {} : { target: "_blank", rel: "noopener noreferrer" };
}

/** Room the floating actions take: 32px each, a divider, and the row's padding. */
function actionsWidth(row: AdminSourceIssue) {
	const buttons = row.links.length + (row.itemKey ? 1 : 0) + 1;
	return buttons * 32 + 9 + 20;
}

const ACTION =
	"grid size-8 shrink-0 place-items-center rounded-lg text-black/45 hover:bg-black/[0.06] hover:text-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/50 dark:hover:bg-white/[0.08] dark:hover:text-white/85";

/**
 * A record's ways out: its source, its public page, the editor, and dismiss.
 * Shown on hover or focus, and always on touch screens.
 */
function RowActions({
	row,
	onOpenRecord,
	onDismiss,
}: {
	row: AdminSourceIssue;
	onOpenRecord: (itemKey: string) => void;
	onDismiss: (row: AdminSourceIssue) => void;
}) {
	return (
		// With a mouse they float at the row's end and the title makes room only while they show; on touch they sit in line.
		<div className="flex shrink-0 items-center [@media(hover:hover)]:pointer-events-none [@media(hover:hover)]:absolute [@media(hover:hover)]:right-2 [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:-translate-y-1/2 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity [@media(hover:hover)]:group-hover/row:pointer-events-auto [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:group-focus-within/row:pointer-events-auto [@media(hover:hover)]:group-focus-within/row:opacity-100 motion-reduce:transition-none">
			{row.links.map((link) => {
				const look = LINK_LOOK[link.kind];
				return (
					<Tooltip key={link.kind} content={look.label}>
						<a
							href={link.href}
							aria-label={`${look.label}: ${row.title}`}
							{...linkTarget(link)}
							className={`${ACTION} [@media(hover:none)]:hidden`}
						>
							{look.icon}
						</a>
					</Tooltip>
				);
			})}
			{/* On touch the links share one menu, so titles keep their room. */}
			<span className="[@media(hover:hover)]:hidden">
				{row.links.length > 0 ? (
					<Dropdown placement="bottom-end">
						<DropdownTrigger>
							<button type="button" aria-label={`Open ${row.title} elsewhere`} className={ACTION}>
								<HugeiconsIcon aria-hidden icon={MoreHorizontalIcon} size={16} />
							</button>
						</DropdownTrigger>
						<DropdownMenu aria-label={`Open ${row.title} elsewhere`}>
							{row.links.map((link) => (
								<DropdownItem
									key={link.kind}
									href={link.href}
									{...linkTarget(link)}
									startContent={<span className="grid size-4 place-items-center">{LINK_LOOK[link.kind].icon}</span>}
								>
									{LINK_LOOK[link.kind].label}
								</DropdownItem>
							))}
						</DropdownMenu>
					</Dropdown>
				) : (
					<span aria-hidden className="invisible block size-8" />
				)}
			</span>
			{row.itemKey ? (
				<Tooltip content="Edit record">
					<button
						type="button"
						aria-label={`Edit record: ${row.title}`}
						onClick={() => onOpenRecord(row.itemKey!)}
						className={ACTION}
					>
						<HugeiconsIcon aria-hidden icon={PencilEdit02Icon} size={15} />
					</button>
				</Tooltip>
			) : (
				// Keeps the touch columns lined up down the list.
				<span aria-hidden className="invisible hidden size-8 [@media(hover:none)]:block" />
			)}
			<span aria-hidden className="mx-1 h-4 w-px bg-black/10 dark:bg-white/10" />
			<Tooltip content="Dismiss" placement="left">
				<button
					type="button"
					aria-label={`Dismiss issue: ${row.title}`}
					onClick={() => onDismiss(row)}
					className={ACTION}
				>
					<HugeiconsIcon aria-hidden icon={Cancel01Icon} size={15} />
				</button>
			</Tooltip>
		</div>
	);
}

/** Keys of every issue request for one source, so a dismissal updates them together. */
const TYPES_KEY = "admin-source-issue-types";
const PAGE_KEY = "admin-source-issue-page";
const typesKey = (sourceKey: string, version: string) => [TYPES_KEY, sourceKey, version] as const;
const pageKey = (sourceKey: string, type: string, offset: number, limit: number, version: string) =>
	[PAGE_KEY, sourceKey, type, offset, limit, version] as const;

/** One page of a type's records. The page kept while the next one loads is marked stale. */
type LoadedPage = AdminSourceIssuePage & { offset: number; limit: number; at: string };

/**
 * Whether the rows on screen are the ones asked for. Rows from before the source's status changed
 * stay usable while they refresh, since a dismissal always applies to the record's current issue;
 * if that refresh fails, they are out of date.
 */
function pageFreshness(data: LoadedPage | undefined, page: { offset: number; limit: number }, version: string, failed: boolean) {
	const otherPage = data?.offset !== page.offset || data?.limit !== page.limit;
	const outdated = otherPage || data?.at !== version;
	return { showError: outdated && failed, stale: otherPage || (outdated && failed) };
}

function useIssuePage(sourceKey: string, type: string, page: { offset: number; limit: number } | null, version: string, polling: boolean) {
	const { data, error } = useSWR(
		page ? pageKey(sourceKey, type, page.offset, page.limit, version) : null,
		async ([, key, kind, offset, limit, at]): Promise<LoadedPage> => ({ ...(await getAdminSourceIssuePage(key, kind, { offset, limit })), offset, limit, at }),
		{ keepPreviousData: true, refreshInterval: polling ? ISSUES_POLL_MS : 0 },
	);
	const { showError, stale } = page ? pageFreshness(data, page, version, Boolean(error)) : { showError: false, stale: false };
	return { error: showError, rows: data?.issues ?? [], stale };
}

/** Where the page sits in the type, and the pages to move between. */
function PageFooter({
	group,
	current,
	pages,
	first,
	shown,
	onPage,
}: {
	group: AdminSourceIssueType;
	current: number;
	pages: number;
	first: number;
	shown: number;
	onPage: (page: number) => void;
}) {
	if (pages <= 1) {
		return (
			<span className="text-xs tabular-nums text-black/50 dark:text-white/50">
				{count(group.count)} {group.count === 1 ? "record" : "records"}
			</span>
		);
	}
	return (
		<>
			<span className="text-xs tabular-nums text-black/50 dark:text-white/50">
				{/* The range once its rows are here; the total while they load. */}
				{shown > 0 ? `${count(first)} to ${count(first + shown - 1)} of ${count(group.count)}` : `${count(group.count)} records`}
			</span>
			<Pagination
				aria-label={`${group.title} pages`}
				total={pages}
				page={current}
				onChange={onPage}
				size="sm"
				siblings={0}
				boundaries={1}
				showControls
				classNames={{
					base: "m-0 p-0",
					wrapper: "gap-1",
					// The dots between page numbers are the only item holding an icon; they are not a button.
					item: "size-8 min-w-8 text-xs [&:has(svg)]:border-transparent [&:has(svg)]:bg-transparent [&:has(svg)]:shadow-none",
					prev: "size-8 min-w-8",
					next: "size-8 min-w-8",
				}}
			/>
		</>
	);
}

/** The records of one issue type, a page at a time, with the fix said once above them. */
function IssueKindPane({
	group,
	sourceKey,
	version,
	polling,
	onOpenRecord,
	onDismiss,
	onDismissAll,
}: {
	group: AdminSourceIssueType;
	sourceKey: string;
	version: string;
	polling: boolean;
	onOpenRecord: (itemKey: string) => void;
	onDismiss: (row: AdminSourceIssue) => void;
	onDismissAll: (group: AdminSourceIssueType) => void;
}) {
	const [listRef, fit] = useRowsThatFit();
	// The first record shown, not the page, so resizing keeps the reader's place.
	const [start, setStart] = useState(0);
	const pageSize = fit?.rows ?? 1;
	const pages = Math.max(1, Math.ceil(group.count / pageSize));
	const current = Math.min(Math.floor(start / pageSize) + 1, pages);
	const offset = (current - 1) * pageSize;
	// The page kept while the next one loads stays in place but cannot be acted on.
	const { error, rows, stale } = useIssuePage(sourceKey, group.key, fit ? { offset, limit: pageSize } : null, version, polling);
	return (
		<div className="flex min-h-0 min-w-0 flex-col">
			<div className="flex h-12 shrink-0 items-center gap-3 border-b border-black/[0.055] px-4 dark:border-white/[0.06]">
				<div className="flex min-w-0 flex-1 items-center gap-1">
					<p className="truncate text-sm font-semibold">{group.title}</p>
					{/* Opens on press, so a tap on a phone reads it too. */}
					<Popover placement="bottom-start" offset={6}>
						<PopoverTrigger>
							<button
								type="button"
								aria-label="How to fix these"
								className="grid size-7 shrink-0 place-items-center rounded-lg text-black/40 hover:bg-black/[0.05] hover:text-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus data-[open=true]:bg-black/[0.05] data-[open=true]:text-black/70 dark:text-white/40 dark:hover:bg-white/[0.07] dark:hover:text-white/70"
							>
								<HugeiconsIcon aria-hidden icon={HelpCircleIcon} size={15} />
							</button>
						</PopoverTrigger>
						<PopoverContent className="max-w-72 items-start rounded-xl border border-black/10 bg-background_light px-3 py-2 text-xs leading-5 text-black/75 dark:border-white/10 dark:bg-card dark:text-white/80">
							{group.next}
						</PopoverContent>
					</Popover>
				</div>
				<Button
					size="xs"
					variant="transparent"
					className="h-8 shrink-0 rounded-lg px-2.5 text-xs text-black/60 dark:text-white/60"
					startContent={<HugeiconsIcon aria-hidden icon={Cancel01Icon} size={14} />}
					onPress={() => onDismissAll(group)}
				>
					Dismiss all
				</Button>
			</div>
			{/* Outside the list, which goes inert while stale, so the failure is still announced. */}
			{error ? <p role="alert" className="shrink-0 px-4 pt-2 text-xs text-danger">These records could not be loaded.</p> : null}
			<ul
				ref={listRef}
				aria-busy={stale && !error}
				aria-label={`${group.title} records`}
				inert={stale}
				className={`min-h-0 flex-1 overflow-hidden px-1 py-2 transition-opacity motion-reduce:transition-none ${stale ? "opacity-50" : ""}`}
			>
				{rows.map((row) => (
					<IssueRecord
						key={row.sourceRecordKey}
						row={row}
						height={fit?.height ?? ROW_HEIGHT}
						onOpenRecord={onOpenRecord}
						onDismiss={onDismiss}
					/>
				))}
			</ul>
			<div className="flex h-12 shrink-0 items-center justify-between gap-3 border-t border-black/[0.055] px-4 dark:border-white/[0.06]">
				<PageFooter
					group={group}
					current={current}
					pages={pages}
					first={offset + 1}
					shown={rows.length}
					onPage={(page) => setStart((page - 1) * pageSize)}
				/>
			</div>
		</div>
	);
}

type DismissTarget = { record: string; type: string } | { type: string };

/** The rail's counts without what was just dismissed, before the server answers. */
type IssueTypes = { types: AdminSourceIssueType[] };

function typesWithout(data: IssueTypes | undefined, target: DismissTarget): IssueTypes {
	if (!data) return { types: [] };
	const types = data.types.map((type) =>
		type.key === target.type ? { ...type, count: "record" in target ? type.count - 1 : 0 } : type,
	);
	return { ...data, types: types.filter((type) => type.count > 0) };
}

/** A loaded page of the dismissed type without what was just dismissed. */
function pageWithout(data: AdminSourceIssuePage | undefined, target: DismissTarget): AdminSourceIssuePage {
	if (!data) return { count: 0, issues: [] };
	const issues = "record" in target ? data.issues.filter((row) => row.sourceRecordKey !== target.record) : [];
	return { count: Math.max(0, data.count - (data.issues.length - issues.length)), issues };
}

/**
 * Records the import could not bring in whole. Issue types sit in a rail;
 * the chosen type's records fill the pane beside it, a page at a time.
 * Dismissing an issue removes it from view, and the toast can undo it.
 */
function SourceIssues({
	sourceKey,
	types,
	version,
	polling,
	onOpenRecord,
	onIssuesChanged,
}: {
	sourceKey: string;
	types: AdminSourceIssueType[];
	version: string;
	polling: boolean;
	onOpenRecord: (itemKey: string) => void;
	onIssuesChanged: () => void;
}) {
	const [chosen, setChosen] = useState<string | null>(null);
	const { mutate } = useSWRConfig();
	const selected = types.find((group) => group.key === chosen) ?? types[0] ?? null;
	const total = types.reduce((sum, group) => sum + group.count, 0);
	const cached = (kind: string, type?: string) => (key: unknown) =>
		Array.isArray(key) && key[0] === kind && key[1] === sourceKey && (type === undefined || key[2] === type);
	const refresh = () => {
		void mutate((key: unknown) => cached(TYPES_KEY)(key) || cached(PAGE_KEY)(key));
		onIssuesChanged();
	};

	async function dismiss(target: DismissTarget) {
		const request = dismissAdminSourceIssues(
			sourceKey,
			"record" in target ? { record: target.record } : { type: target.type },
		);
		// Hidden at once; put back if the server refuses.
		const optimistic = { populateCache: false, revalidate: false, rollbackOnError: true, throwOnError: false };
		const settled = request.then(() => undefined);
		void mutate<IssueTypes | undefined>(cached(TYPES_KEY), settled, {
			...optimistic,
			optimisticData: (data) => typesWithout(data, target),
		});
		void mutate<AdminSourceIssuePage | undefined>(cached(PAGE_KEY, target.type), settled, {
			...optimistic,
			optimisticData: (data) => pageWithout(data, target),
		});
		try {
			const { batch, count: dismissed } = await request;
			if (batch) toast(dismissed === 1 ? "Issue dismissed" : `${count(dismissed)} issues dismissed`, {
				action: {
					label: "Undo",
					onClick: () =>
						void restoreAdminSourceIssues(sourceKey, batch).then(refresh, () =>
							toast.error("The issues could not be restored. Try again."),
						),
				},
			});
		} catch {
			toast.error("The issue could not be dismissed. Try again.");
		}
		refresh();
	}

	if (!selected) {
		return (
			<p className="flex items-center gap-2 border-t border-black/[0.07] px-5 py-4 text-sm text-black/55 dark:border-white/[0.07] dark:text-white/55 sm:px-6">
				<HugeiconsIcon aria-hidden icon={Tick01Icon} size={16} className="text-emerald-700 dark:text-emerald-400" />
				No record issues to fix.
			</p>
		);
	}
	return (
		<section
			aria-label="Record issues"
			className="motion-safe:animate-fade-in motion-safe:[animation-duration:360ms] grid min-h-[240px] flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] border-t border-black/[0.07] dark:border-white/[0.07] sm:grid-cols-[232px_minmax(0,1fr)] sm:grid-rows-1"
		>
			<aside className="flex min-h-0 min-w-0 flex-col border-b border-black/[0.07] bg-black/[0.015] dark:border-white/[0.07] dark:bg-white/[0.02] sm:border-b-0 sm:border-r">
				<div className="flex h-12 shrink-0 items-center justify-between gap-2 px-4">
					<h3 className="text-sm font-semibold">Record issues</h3>
					<span className="text-xs font-medium tabular-nums text-black/50 dark:text-white/50">{count(total)}</span>
				</div>
				<div className="flex gap-1 overflow-x-auto px-2 pb-2 max-sm:[scrollbar-width:none] sm:flex-col sm:overflow-y-auto">
					{types.map((group) => (
						<IssueKindButton
							key={group.key}
							group={group}
							selected={group.key === selected.key}
							onSelect={() => setChosen(group.key)}
						/>
					))}
				</div>
			</aside>
			<IssueKindPane
				key={selected.key}
				group={selected}
				sourceKey={sourceKey}
				version={version}
				polling={polling}
				onOpenRecord={onOpenRecord}
				onDismiss={(row) => void dismiss({ record: row.sourceRecordKey, type: selected.key })}
				onDismissAll={(group) => void dismiss({ type: group.key })}
			/>
		</section>
	);
}

/* The dialog and its sidebar button */

const issueTotal = (activity: SourceStatus) => Object.values(activity.issues).reduce((sum, value) => sum + value, 0);

function sourceSubtitle(source: AdminSource) {
	if (source.provider === "zotero") {
		return source.scopeKind === "group" ? `Zotero group ${source.externalScopeKey}` : "Zotero library";
	}
	if (source.provider === "openalex") return "OpenAlex search";
	return source.provider === "openscholar" ? "Openscholar collection" : sourceProviderName(source.provider);
}

/** Status version: the polled issue counts, and a run ending, since an import can swap issues without changing a count. */
function statusVersion(activity: SourceStatus) {
	return JSON.stringify([activity.state, activity.lastSuccessAt, activity.state === "failed" ? activity.failure.at : null, activity.issues]);
}

/** What to ask for: nothing for a source that never imported, which has no issues. */
function issueTypesRequest(sourceKey: string | null, activity: SourceStatus | null) {
	const imported = activity !== null && activity.state !== "idle";
	const version = activity ? statusVersion(activity) : "";
	return { imported, running: activity?.state === "running", version, key: sourceKey && imported ? typesKey(sourceKey, version) : null };
}

/** Kept data belongs to this source, and to its current status unless the refresh that would replace it failed. */
function isCurrentTypes(loaded: { sourceKey: string; at: string } | undefined, sourceKey: string | null, version: string, failed: boolean) {
	return loaded?.sourceKey === sourceKey && (loaded.at === version || !failed);
}

/** The source's issue types, never another source's, nor ones kept from before a failed refresh. */
function useIssueTypes(sourceKey: string | null, activity: SourceStatus | null) {
	const { imported, running, version, key } = issueTypesRequest(sourceKey, activity);
	const { data: loaded, error } = useSWR(
		key,
		async ([, source, at]) => ({ ...(await getAdminSourceIssueTypes(source)), sourceKey: source, at }),
		{ keepPreviousData: true, refreshInterval: running ? ISSUES_POLL_MS : 0 },
	);
	const data = isCurrentTypes(loaded, sourceKey, version, Boolean(error)) ? loaded : undefined;
	return { data, error, imported, running, version };
}

/** How the dialog changes size: the same curve iOS sheets use. */
const RESIZE = { duration: 420, easing: "cubic-bezier(0.32, 0.72, 0, 1)" };

/**
 * Grows or shrinks the frame to its content's height instead of jumping, as
 * issues arrive or leave. The content is laid out at its final size at once
 * and the frame reveals it, so nothing inside reflows while it moves. A ref
 * callback, since the frame only exists while the dialog is open.
 */
function animateHeight(frame: HTMLDivElement | null) {
	const content = frame?.firstElementChild;
	if (!frame || !(content instanceof HTMLElement)) return;
	// The content's size reaches React only through this observer; the Web Animations API moves the frame.
	let last: number | null = null;
	const observer = new ResizeObserver(() => {
		// Layout heights, not on-screen boxes: the dialog opens with a scale, which a CSS height must not include.
		const next = content.offsetHeight;
		const running = frame.getAnimations();
		// Mid-animation, start from where the frame is now.
		const from = running.length > 0 ? frame.offsetHeight : last;
		last = next;
		if (from === null || Math.abs(from - next) < 1) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		for (const animation of running) animation.cancel();
		frame.animate([{ height: `${from}px` }, { height: `${next}px` }], RESIZE);
	});
	observer.observe(content);
	return () => observer.disconnect();
}

/** Import state and record issues of one external source. */
export function AdminSourceStatusDialog({
	source,
	configurationHref,
	onClose,
	onIssuesChanged,
	onOpenRecord,
}: {
	source: AdminSource | null;
	/** The library's configuration in OpenScholar, where a failed import is fixed. */
	configurationHref: string | null;
	onClose: () => void;
	/** Called after issues were dismissed or restored, so the sidebar count follows. */
	onIssuesChanged: () => void;
	onOpenRecord: (itemKey: string) => void;
}) {
	const activity = source?.activity ?? null;
	const { data, error, imported, running, version } = useIssueTypes(source?.key ?? null, activity);
	// A source whose status counts no open issues shows that at once, so the dialog never grows to say it.
	const types = data?.types ?? (activity && issueTotal(activity) === 0 && !error ? [] : undefined);
	const showIssues = imported && types !== undefined;
	const fills = showIssues && types.length > 0;
	return (
		<DialogModal
			isOpen={Boolean(source && activity)}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			placement="center"
			scrollBehavior="inside"
			size="3xl"
			hideCloseButton
			classNames={{ base: "!my-4 !max-h-[calc(100dvh-2rem)] !max-w-[820px] overflow-hidden rounded-2xl" }}
		>
			<ModalContent className="overflow-hidden">
				{(close) =>
					source && activity ? (
						<div ref={animateHeight} className="overflow-hidden">
						<div
							className={`flex flex-col ${fills ? "h-[min(820px,calc(100dvh-2rem))]" : "max-h-[calc(100dvh-2rem)]"}`}
						>
							<ModalHeader className="flex shrink-0 items-center gap-3 px-5 py-4 font-normal sm:px-6">
								<span className="grid size-11 shrink-0 place-items-center self-start rounded-xl bg-black/[0.04] dark:bg-white/[0.07]">
									<SourceProviderIcon provider={source.provider} size={22} />
								</span>
								<div className="min-w-0 flex-1">
									<h2 className="truncate text-lg font-semibold leading-6">{source.label}</h2>
									<p className="mt-0.5 text-xs leading-4 text-black/50 dark:text-white/50">{sourceSubtitle(source)}</p>
								</div>
								<Button
									isIconOnly
									aria-label="Close"
									variant="transparent"
									size="xs"
									onPress={close}
									className="size-8 shrink-0 rounded-lg text-black/50 dark:text-white/50"
								>
									<HugeiconsIcon icon={Cancel01Icon} size={18} />
								</Button>
							</ModalHeader>
							<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
								<SourceActivityPanel activity={activity} configurationHref={configurationHref} paused={source.status === "paused"} />
								{showIssues ? (
									<SourceIssues
										key={source.key}
										sourceKey={source.key}
										types={types}
										version={version}
										polling={running}
										onIssuesChanged={onIssuesChanged}
										onOpenRecord={(itemKey) => {
											close();
											onOpenRecord(itemKey);
										}}
									/>
								) : imported && error ? (
									<p role="alert" className="border-t border-black/[0.07] px-5 py-4 text-sm text-danger dark:border-white/[0.07] sm:px-6">
										Record issues could not be loaded. They load again at the next update.
									</p>
								) : null}
							</div>
						</div>
						</div>
					) : null
				}
			</ModalContent>
		</DialogModal>
	);
}

const BADGE: Record<SourceStatus["state"], { className: string; icon: typeof Clock01Icon; spin: boolean }> = {
	failed: { className: "text-danger", icon: AlertCircleIcon, spin: false },
	idle: { className: "text-black/35 dark:text-white/35", icon: Clock01Icon, spin: false },
	running: { className: "text-accent", icon: Loading03Icon, spin: true },
	succeeded: { className: "text-emerald-600 dark:text-emerald-400", icon: CheckmarkCircle02Icon, spin: false },
};

function badgeDescription(activity: SourceStatus) {
	const state =
		activity.state === "running"
			? { import: "Importing", search: "Updating search", pdfs: "Adding PDFs" }[activity.phase]
			: activity.state === "failed"
				? "Last import failed"
				: activity.state === "succeeded"
					? "Up to date"
					: "Not imported yet";
	const issues = issueTotal(activity);
	return [
		state,
		activity.searchFailed > 0 ? `${count(activity.searchFailed)} not in search` : null,
		issues > 0 ? `${count(issues)} ${issues === 1 ? "record issue" : "record issues"}` : null,
	]
		.filter(Boolean)
		.join(", ");
}

/** The small status button shown next to a source in the sidebar. */
export function AdminSourceStatusBadge({
	label,
	onClick,
	activity,
}: {
	label: string;
	onClick: () => void;
	activity: SourceStatus;
}) {
	// Records missing from search make an up-to-date source a problem too.
	const look = BADGE[activity.state === "succeeded" && activity.searchFailed > 0 ? "failed" : activity.state];
	const issues = issueTotal(activity);
	return (
		<Tooltip content={badgeDescription(activity)}>
			<button
				aria-label={`${label} import: ${badgeDescription(activity)}`}
				className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium hover:bg-black/[0.05] dark:hover:bg-white/[0.06] ${look.className}`}
				data-admin-source-sync={activity.state}
				onClick={onClick}
				type="button"
			>
				<HugeiconsIcon
					aria-hidden
					className={look.spin ? "animate-spin motion-reduce:animate-none" : undefined}
					icon={look.icon}
					size={13}
				/>
				{issues > 0 ? <span>{count(issues)}</span> : null}
			</button>
		</Tooltip>
	);
}
