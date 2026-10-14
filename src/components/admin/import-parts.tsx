"use client";

import { ArrowDown01Icon, ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Suspense, use, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { TruncatedText } from "@/components/nextui/TruncatedText";

import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import type { ImportStage } from "./ImportSteps";
import { megabytes, RemoveButton } from "./ImportInputs";
import { adminPanelTabState } from "./admin-tab-styles";
import type { ImportFlowState } from "./import-flow";
import { pdfPageCount } from "./pdf-thumbnail";

/** The stage's content, faded in when the stage changes. */
export function StageFade({ children, className = "flex min-h-0 flex-1 flex-col", stage }: { children: ReactNode; className?: string; stage: ImportStage }) {
	const reduceMotion = useReducedMotion();
	return (
		<AnimatePresence initial={false} mode="wait">
			<motion.div animate={{ opacity: 1 }} className={className} exit={{ opacity: 0 }} initial={{ opacity: 0 }} key={stage} transition={{ duration: reduceMotion ? 0 : 0.15 }}>
				{children}
			</motion.div>
		</AnimatePresence>
	);
}

/** The error to show in a footer, or the cost estimate while PDFs are chosen. */
export function InputNote({ flow }: { flow: ImportFlowState }) {
	const problem = flow.error ?? flow.footerProblem;
	if (problem) {
		return (
			<p className="min-w-0 flex-1 text-sm leading-5 text-danger [overflow-wrap:anywhere]" role="alert">
				{problem}
			</p>
		);
	}
	return null;
}

function Pages({ file }: { file: File }) {
	const count = use(pdfPageCount(file));
	return count ? <>{count} {count === 1 ? "page" : "pages"}</> : null;
}

/** A chosen PDF's page count, read in the browser; the space is held while it is counted. */
function PageCount({ file }: { file: File }) {
	return (
		<span className="inline-block min-w-[4.5rem] text-xs tabular-nums text-black/45 dark:text-white/45">
			<Suspense fallback={null}>
				<Pages file={file} />
			</Suspense>
		</span>
	);
}

/** The chosen PDFs as compact rows with their pages and size, a page at a time. */
export function PdfRows({ busy, files, onFilesChange, perPage = 6 }: { busy: boolean; files: File[]; onFilesChange: (files: File[]) => void; perPage?: number }) {
	const [page, setPage] = useState(1);
	const { current, items, pages } = pageOf(files, page, perPage);
	return (
		<div>
			<ul className="flex flex-col">
				{items.map((file) => (
					<li className="flex h-12 items-center gap-3 rounded-lg pe-1 ps-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]" key={`${file.name}:${file.size}`}>
						<ImportCover className="w-7" pdf={file} size={12} />
						<span className="min-w-0 flex-1 text-sm text-black/80 dark:text-white/80">
							<TruncatedText text={file.name} />
						</span>
						<PageCount file={file} />
						<span className="w-14 text-end text-xs tabular-nums text-black/45 dark:text-white/45">{megabytes(file.size)}</span>
						<RemoveButton busy={busy} name={file.name} onPress={() => onFilesChange(files.filter((other) => other !== file))} />
					</li>
				))}
			</ul>
			<ImportPager label="Pages of chosen PDFs" onChange={setPage} page={current} pages={pages} perPage={perPage} total={files.length} />
		</div>
	);
}

type SheetTab<Id extends string> = { count?: number; icon?: typeof ArrowLeft01Icon; id: Id; label: string };

/**
 * The sheet's tabs, in the admin's panel style as in the record inspector:
 * the chosen tab joins the panel below it. Used for the source on the Add
 * step and the filter on the review.
 */
export function SheetTabs<Id extends string>({ disabled = false, label, onSelect, panelId, selected, tabs }: { disabled?: boolean; label: string; onSelect: (id: Id) => void; panelId: string; selected: Id; tabs: SheetTab<Id>[] }) {
	const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
		const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
		if (!step) return;
		event.preventDefault();
		const next = tabs[(index + step + tabs.length) % tabs.length]!;
		onSelect(next.id);
		document.getElementById(`${panelId}-tab-${next.id}`)?.focus();
	};
	return (
		<div aria-label={label} className="flex shrink-0 overflow-x-auto px-3 [scrollbar-width:none]" role="tablist">
			{tabs.map((tab, index) => {
				const active = tab.id === selected;
				return (
					<button
						aria-controls={panelId}
						aria-selected={active}
						className={`flex min-h-11 flex-auto items-center justify-center gap-1.5 whitespace-nowrap px-3 text-xs font-medium outline-none transition-background-text focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed ${adminPanelTabState(active)}`}
						disabled={disabled}
						id={`${panelId}-tab-${tab.id}`}
						key={tab.id}
						onClick={() => onSelect(tab.id)}
						onKeyDown={(event) => move(event, index)}
						role="tab"
						tabIndex={active ? 0 : -1}
						type="button"
					>
						{tab.icon ? <HugeiconsIcon aria-hidden className="shrink-0" icon={tab.icon} size={18} strokeWidth={1.8} /> : null}
						{tab.label}
						{tab.count === undefined ? null : <span className="tabular-nums text-black/40 dark:text-white/40">{tab.count}</span>}
					</button>
				);
			})}
		</div>
	);
}

/** A group of rows on a soft surface: the settings at the top of each step, and a record's parts. */
/** The sheet's motion: a quick ease-out, or none for someone who asked for less motion. */
export const sheetTransition = (reduceMotion: boolean | null, seconds: number) => ({ duration: reduceMotion ? 0 : seconds, ease: [0.32, 0.72, 0, 1] as const });

/** A setting's summary: how many there are, or what it says when there are none. */
export const countSummary = (count: number, one: string, many: string, none: string) => (count ? `${count} ${count === 1 ? one : many}` : none);

export function SettingsGroup({ children }: { children: ReactNode }) {
	return <div className="shrink-0 divide-y divide-black/[0.05] overflow-hidden rounded-xl bg-black/[0.025] dark:divide-white/[0.06] dark:bg-white/[0.035]">{children}</div>;
}

const rowClass = "flex h-12 w-full items-center gap-3 px-4 text-start";

/**
 * Focus that moves into a section the editor opens (the collection search
 * does) is brought into view once the section has its height and the focus
 * has arrived, whichever comes last. Scrolling sooner would scroll the
 * section itself while it is still clipped.
 */
function useOpeningFocusReveal() {
	// "opening" until the section has its height, remembering what took focus meanwhile, then "open" until focus first arrives.
	const state = useRef<{ focused: Element | null; phase: "idle" | "opening" | "open" }>({ focused: null, phase: "idle" });
	const reveal = (element: Element) => {
		state.current = { focused: null, phase: "idle" };
		element.scrollIntoView({ block: "nearest" });
	};
	return {
		onFocus: (event: FocusEvent) => {
			if (state.current.phase === "opening") state.current.focused = event.target;
			else if (state.current.phase === "open") reveal(event.target);
		},
		opened: () => {
			const { focused, phase } = state.current;
			if (phase !== "opening") return;
			if (focused && focused === document.activeElement) reveal(focused);
			else state.current = { focused: null, phase: "open" };
		},
		opening: () => {
			state.current = { focused: null, phase: "opening" };
		},
	};
}

/** One row of a group: what it holds now, and what it shows when it opens in place. */
export function Setting({ children, defaultOpen = false, icon, summary, title }: { children: ReactNode; defaultOpen?: boolean; icon: typeof ArrowLeft01Icon; summary: ReactNode; title: string }) {
	const reduceMotion = useReducedMotion();
	const [open, setOpen] = useState(defaultOpen);
	const focusReveal = useOpeningFocusReveal();
	const toggle = () => {
		if (!open) focusReveal.opening();
		setOpen(!open);
	};
	return (
		<div>
			<button aria-expanded={open} className={`${rowClass} outline-none transition-colors duration-150 hover:bg-black/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-white/[0.03]`} onClick={toggle} type="button">
				<HugeiconsIcon aria-hidden className="shrink-0 text-black/45 dark:text-white/45" icon={icon} size={17} />
				<span className="shrink-0 text-sm font-medium text-black/85 dark:text-white/85">{title}</span>
				<span className="flex min-w-0 flex-1 justify-end truncate text-xs text-black/45 dark:text-white/45">{summary}</span>
				<HugeiconsIcon aria-hidden className={`shrink-0 text-black/35 transition-transform duration-200 dark:text-white/35 ${open ? "rotate-180" : ""}`} icon={ArrowDown01Icon} size={15} />
			</button>
			<AnimatePresence initial={false}>
				{open ? (
					<motion.div animate={{ height: "auto", opacity: 1 }} className="overflow-hidden" exit={{ height: 0, opacity: 0 }} initial={{ height: 0, opacity: 0 }} transition={sheetTransition(reduceMotion, 0.22)} onAnimationComplete={focusReveal.opened}>
						<div className="px-4 pb-4 pt-1" onFocus={focusReveal.onFocus}>{children}</div>
					</motion.div>
				) : null}
			</AnimatePresence>
		</div>
	);
}

/** A row of a group that only states something, such as how many drafts were created. */
export function SummaryRow({ icon, title, tone = "", value }: { icon: typeof ArrowLeft01Icon; title: string; tone?: string; value: ReactNode }) {
	return (
		<div className={rowClass}>
			<HugeiconsIcon aria-hidden className="shrink-0 text-black/45 dark:text-white/45" icon={icon} size={17} />
			<span className="min-w-0 flex-1 truncate text-sm text-black/80 dark:text-white/80">{title}</span>
			<span className={`shrink-0 text-sm font-medium tabular-nums text-black/85 dark:text-white/85 ${tone}`}>{value}</span>
		</div>
	);
}

/** A list's title row: what it holds, a note beside it, and an action at the end. */
export function ListHeader({ action, aside, lead, title }: { action?: ReactNode; aside?: ReactNode; lead?: ReactNode; title: ReactNode }) {
	return (
		<div className="flex h-8 shrink-0 items-center gap-3">
			{lead}
			<h3 className="whitespace-nowrap text-sm font-medium text-black/85 dark:text-white/85">{title}</h3>
			{aside ? <span className="flex min-w-0 items-center gap-3 truncate text-xs tabular-nums text-black/45 dark:text-white/45">{aside}</span> : null}
			{action ? <span className="ms-auto flex shrink-0 items-center">{action}</span> : null}
		</div>
	);
}
