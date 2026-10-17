"use client";

import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { motion, useReducedMotion } from "framer-motion";
import { useState, type KeyboardEvent } from "react";
import { SearchBar } from "@/components/features/SearchBar";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { twMerge } from "@/lib/tw-merge";
import type { Loaded, More } from "./client";
import type { ChainEntry } from "./data";
import type { Selection } from "./graph";
import { Chains, CheckSwitches, muted, PANEL, ResultList, type Checked, type Checks, type Filters, type Lit, type OnHover, type Results } from "./lists";
import { OpenedPaper } from "./paper";
import { usePaper } from "./records";

type Tab = "paper" | "results";
/**
 * The search and the checks, at the top of the screen. A phone on its side keeps its little height for the map: no switches,
 * unless one is on, which stays there to be turned off.
 */
function TopBar({ filters, onSearch, onTyped, checks }: { filters: Filters; onSearch: (text: string) => void; onTyped: (text: string | null) => void; checks: Checks }) {
	return (
		<div data-evidence-top className="fixed inset-x-3 top-20 z-10 space-y-2 xl:hidden [@media(max-width:1279px)_and_(orientation:landscape)]:right-auto [@media(max-width:1279px)_and_(orientation:landscape)]:w-[calc(100%-min(26rem,55%)-1.5rem)]">
			<div className={twMerge(PANEL, "p-1.5")}><SearchBar handleSearchChange={onSearch} onTyped={onTyped} search={filters.queryParams.search} /></div>
			<div className={twMerge(PANEL, "p-1.5", checks.types.size + checks.verdicts.size === 0 && "[@media(max-width:1279px)_and_(orientation:landscape)_and_(max-height:600px)]:hidden")}><CheckSwitches {...checks} wrap={false} /></div>
		</div>
	);
}

/** The tab a key moves to: right and End to the results, left and Home to the paper. */
const tabFor = (key: string): Tab | null => ({ ArrowRight: "results", End: "results", ArrowLeft: "paper", Home: "paper" } as Record<string, Tab>)[key] ?? null;

/** Paper and Results, when there is both: the arrow keys, Home and End move between them, as tabs do. */
function SheetTabs({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
	const keys = (event: KeyboardEvent) => {
		const next = tabFor(event.key);
		if (!next) return;
		event.preventDefault();
		onTab(next);
		document.getElementById(`evidence-tab-${next}`)?.focus();
	};
	return (
		<div role="tablist" aria-label="Sheet" onKeyDown={keys} className="flex shrink-0 gap-1 px-3 pt-3">
			{(["paper", "results"] as const).map((name) => (
				// Only the chosen tab is in the tab order.
				<button key={name} id={`evidence-tab-${name}`} type="button" role="tab" aria-selected={tab === name} aria-controls="evidence-sheet-panel" tabIndex={tab === name ? 0 : -1} onClick={() => onTab(name)} className={twMerge("flex-1 rounded-xl px-3 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent", tab === name ? "bg-black/[0.07] dark:bg-white/15" : muted)}>
					{name === "paper" ? "Paper" : "Results"}
				</button>
			))}
		</div>
	);
}

/** The chains list, folded to its heading until opened; down the side of a screen lying on its side, always open. */
function FoldedChains({ open, onOpen, ...chains }: { open: boolean; onOpen: (open: boolean) => void; chains: ChainEntry[]; checked: Checked; selected: number | null; onOpenKey: (paper: string) => void; onHover: OnHover }) {
	return (
		<>
			<button type="button" aria-expanded={open} onClick={() => onOpen(!open)} className="flex h-14 shrink-0 items-center justify-between px-5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
				Evidence chains
				<HugeiconsIcon icon={ArrowUp01Icon} size={16} aria-hidden className={twMerge("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
			</button>
			<div className={twMerge("min-h-0 flex-1 flex-col", open ? "flex" : "hidden [@media(max-width:1279px)_and_(orientation:landscape)]:flex")}>
				<Chains {...chains} checked={{ ...chains.checked, onOpen: () => { onOpen(false); chains.checked.onOpen(); } }} onOpenKey={(paper) => { onOpen(false); chains.onOpenKey(paper); }} heading={false} />
			</div>
		</>
	);
}

/** The sheet's height: half the screen with a paper or results in it, less for the opened chains list, a bar when folded. */
const heightOf = (content: string, open: boolean) => (content === "paper" || content === "results" ? "h-[50dvh]" : open ? "h-[46dvh]" : "h-14");

/**
 * The sheet's tab: a newly opened paper comes to the front, as does a paper opened from the results, even the one already
 * open; typing a search brings the results there.
 */
function useSheetTab(selection: Selection | null) {
	const [tab, setTab] = useState<Tab>("paper");
	const [seen, setSeen] = useState<number | null>(null);
	const index = selection?.index ?? null;
	if (index !== seen) {
		setSeen(index);
		if (selection) setTab("paper");
	}
	return [tab, setTab] as const;
}

type SheetProps = { selection: Selection | null; opening: boolean; loaded: Loaded | null; more: More | null; filters: Filters; results: Results | undefined; lit: Lit | undefined; typing: boolean; onTyped: (text: string | null) => void; chains: ChainEntry[]; checked: Checked; checks: Checks; selected: number | null; onOpen: (index: number) => void; onOpenKey: (key: string) => void; onClose: () => void; onHover: OnHover };

/** What the sheet holds: with a paper and results both, the chosen tab; else whichever there is; else the chains list. */
function contentOf(paper: boolean, results: boolean, tab: Tab) {
	if (paper && results) return tab;
	if (paper) return "paper";
	return results ? "results" : "chains";
}

const SHEET = "fixed inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-b-none pb-[env(safe-area-inset-bottom)] xl:hidden [@media(max-width:1279px)_and_(orientation:landscape)]:left-auto [@media(max-width:1279px)_and_(orientation:landscape)]:top-20 [@media(max-width:1279px)_and_(orientation:landscape)]:h-auto [@media(max-width:1279px)_and_(orientation:landscape)]:w-[min(26rem,55%)] [@media(max-width:1279px)_and_(orientation:landscape)]:rounded-r-none [@media(max-width:1279px)_and_(orientation:landscape)]:rounded-bl-none";

/** The search's results in the sheet, a tab of it when a paper is open too. */
function SheetResults({ props, inTab, onOpenKey }: { props: SheetProps; inTab: boolean; onOpenKey: (key: string) => void }) {
	return (
		<div id="evidence-sheet-panel" role={inTab ? "tabpanel" : undefined} aria-labelledby={inTab ? "evidence-tab-results" : undefined} className="flex min-h-0 flex-1 flex-col pt-2">
			<ResultList filters={props.filters} results={props.results} lit={props.lit} typing={props.typing} more={props.more} loaded={props.loaded} onOpenKey={onOpenKey} onHover={props.onHover} />
		</div>
	);
}

/**
 * Below 1,280 px the map takes the screen. The search and the checks sit at the top. One sheet holds the opened paper, the
 * search's results, or the evidence chains: along the bottom when the screen stands up, down the right side when it lies on its
 * side, so the map keeps its height. With a paper open and a search typed, two tabs switch between them.
 */
export function PhoneSheet(props: SheetProps) {
	const { loaded, more, results } = props;
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useSheetTab(props.selection);
	const { shown, stale } = usePaper(props.selection, more, props.opening);
	const still = useReducedMotion();
	const paper = shown && loaded && more ? { shown, loaded, more } : null;
	const content = contentOf(Boolean(paper), Boolean(results), tab);
	const both = Boolean(paper && results);
	// Opening a paper from the results brings the paper forward, even the one already open; a search brings the results.
	const front = <T,>(to: Tab, then: (value: T) => void) => (value: T) => { setTab(to); then(value); };
	return (
		<>
			<TopBar filters={props.filters} onSearch={front("results", props.filters.handleSearchChange)} onTyped={props.onTyped} checks={props.checks} />
			<motion.div data-evidence-sheet layout={!still} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className={twMerge(PANEL, SHEET, heightOf(content, open))}>
				{both && <SheetTabs tab={tab} onTab={setTab} />}
				{content === "paper" && paper && <OpenedPaper {...paper} stale={stale} onOpen={front("paper", props.onOpen)} onClose={props.onClose} onHover={props.onHover} scrollAll tab={{ id: "evidence-sheet-panel", labelledBy: both ? "evidence-tab-paper" : undefined }} />}
				{content === "results" && <SheetResults props={props} inTab={Boolean(paper)} onOpenKey={front("paper", props.onOpenKey)} />}
				{content === "chains" && <FoldedChains open={open} onOpen={setOpen} chains={props.chains} checked={props.checked} selected={props.selected} onOpenKey={props.onOpenKey} onHover={props.onHover} />}
			</motion.div>
		</>
	);
}
