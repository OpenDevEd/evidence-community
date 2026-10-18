"use client";

import { CenterFocusIcon, MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "framer-motion";
import { useState, type ReactNode, type Ref } from "react";
import type { ListItem } from "@/app/api/item/types";
import { SearchBar } from "@/components/features/SearchBar";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { filledInputSlots } from "@/components/nextui/field-styles";
import { Tooltip } from "@/components/nextui/Tooltip";
import { twMerge } from "@/lib/tw-merge";
import type { Loaded, More } from "./client";
import { CHECKED, type ChainEntry, type Label } from "./data";
import type { EvidenceGraph, Selection } from "./graph";
import { useHover, type Hover } from "./hover";
import { MapFilter, type Checks } from "./filter";
import { Chains, EvidenceIntro, muted, PANEL, ResultList, type Checked, type Filters, type Lit, type OnHover, type Results } from "./lists";
import { OpenedPaper } from "./paper";
import { labelOfRecord, usePaper, useRecord } from "./records";
import { VerdictChip } from "./verdict-chip";

/** Where a pane sits: the list under it, out to the left and faded; on screen; or past the panel's right edge, not in yet. */
const PANE = {
	enter: (step: number) => (step > 0 ? { x: "100%", opacity: 1, zIndex: 2 } : step < 0 ? { x: "-25%", opacity: 0, zIndex: 1 } : { x: 0, opacity: 0, zIndex: 2 }),
	center: { x: 0, opacity: 1 },
	exit: (step: number) => (step > 0 ? { x: "-25%", opacity: 0, zIndex: 1 } : step < 0 ? { x: "100%", opacity: 1, zIndex: 2 } : { x: 0, opacity: 0, zIndex: 1 }),
};
/** As a screen pushed on a phone: quick out of the start, long and soft into place. */
const PUSH = { duration: 0.42, ease: [0.32, 0.72, 0, 1] as const };

/** Which way the panel moved to this pane: deeper (1), back out (-1), or across to one as deep (0). */
function useStep(key: string, depth: number) {
	const [seen, setSeen] = useState({ key, depth, step: 0 });
	if (seen.key !== key) setSeen({ key, depth, step: Math.sign(depth - seen.depth) });
	return seen.step;
}

type Navigated = { selection: Selection | null; opening: boolean; deep: boolean; back: string; onOpen: (index: number) => void; onClose: () => void };

/**
 * The panel under its head, a stack as a phone's screens are: the search, the checks and the starting points or the search's
 * results, and over them, slid in
 * from the right, the opened paper or the appraised papers. Back slides it away again, to the list as it was left.
 */
function Stack({ list, opened, loaded, more, onHover }: { list: ReactNode; opened: Navigated; loaded: Loaded | null; more: More | null; onHover: OnHover }) {
	const { shown, stale } = usePaper(opened.selection, more, opened.opening);
	const still = useReducedMotion();
	const ready = shown && loaded && more ? { shown, loaded, more } : null;
	const key = ready ? String(ready.shown.selection.index) : "list";
	const depth = !ready ? 0 : ready.shown.selection.index !== CHECKED && opened.deep ? 2 : 1;
	const step = useStep(key, depth);
	const transition = still ? { duration: 0 } : PUSH;
	return (
		<div className="relative min-h-0 flex-1 overflow-hidden">
			<motion.div inert={Boolean(ready)} aria-hidden={ready ? true : undefined} initial={false} animate={ready ? { x: "-25%", opacity: 0 } : { x: 0, opacity: 1 }} transition={transition} className="absolute inset-0 flex flex-col">
				{list}
			</motion.div>
			<AnimatePresence initial={false} custom={step}>
				{ready && (
					<motion.div key={key} role="region" aria-label="Paper" custom={step} variants={PANE} initial="enter" animate="center" exit="exit" transition={transition} className="absolute inset-0 flex flex-col bg-white shadow-[-16px_0_32px_-24px_rgb(0_0_0/0.35)] dark:bg-secondary-400">
						<OpenedPaper {...ready} stale={stale} onOpen={opened.onOpen} onClose={opened.onClose} onHover={onHover} back={opened.back} />
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

/**
 * From 1,280 px wide, a panel down the left: what the page is, with the appraised papers' button; the search and the checks;
 * then the starting points or the search's results. An opened paper takes the place of all three.
 */
export function SearchPanel({ ref, filters, results, lit, typing, onTyped, loaded, more, chains, papers, checked, checks, selected, onOpenKey, onHover, opened, smallLayout }: { ref: Ref<HTMLDivElement>; filters: Filters; results: Results | undefined; lit: Lit | undefined; typing: boolean; onTyped: (text: string | null) => void; loaded: Loaded | null; more: More | null; chains: ChainEntry[]; papers: number; checked: Checked; checks: Checks; selected: number | null; onOpenKey: (key: string) => void; onHover: OnHover; opened: Navigated; smallLayout: boolean }) {
	const list = (
		<>
			<div className="px-3 pb-1">
				<SearchBar handleSearchChange={filters.handleSearchChange} onTyped={onTyped} search={filters.queryParams.search} classNames={filledInputSlots} />
			</div>
			<div className="border-b border-black/[0.06] px-3 pb-3 dark:border-white/[0.08]">
				<MapFilter {...checks} />
			</div>
			<div className="flex min-h-0 flex-1 flex-col pt-2">
				{results
					? <ResultList filters={filters} results={results} lit={lit} typing={typing} more={more} loaded={loaded} onOpenKey={onOpenKey} onHover={onHover} />
					: <Chains chains={chains} selected={selected} onOpenKey={onOpenKey} onHover={onHover} />}
			</div>
		</>
	);
	return (
		<div ref={ref} className={twMerge("pointer-events-none fixed inset-y-0 left-0 z-10 hidden w-[calc(23rem+1rem)] pb-4 pl-4 pt-[calc(7.5rem-1.5rem)] xl:block", smallLayout && "pt-[7.5rem]")}>
			<div className={twMerge(PANEL, "pointer-events-auto flex h-full flex-col overflow-hidden")}>
				<EvidenceIntro papers={papers} reviews={chains.length} checked={checked} />
				<Stack list={list} opened={opened} loaded={loaded} more={more} onHover={onHover} />
			</div>
		</div>
	);
}

/** Zoom, from 1,280 px wide: at the map's bottom left, beside the search panel, where an opened paper never covers it. */
export function Controls({ graph }: { graph: EvidenceGraph | null }) {
	const button = "grid size-9 place-items-center rounded-xl outline-none transition-colors hover:bg-black/[0.05] focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 dark:hover:bg-white/10";
	return (
		<div className={twMerge(PANEL, "fixed bottom-4 left-[calc(24rem+0.5rem)] z-10 hidden flex-col gap-0.5 p-1 xl:flex")}>
			<Tooltip content="Zoom in" placement="right"><button type="button" aria-label="Zoom in" disabled={!graph} onClick={() => graph?.zoomBy(1.6)} className={button}><HugeiconsIcon icon={PlusSignIcon} size={16} /></button></Tooltip>
			<Tooltip content="Zoom out" placement="right"><button type="button" aria-label="Zoom out" disabled={!graph} onClick={() => graph?.zoomBy(1 / 1.6)} className={button}><HugeiconsIcon icon={MinusSignIcon} size={16} /></button></Tooltip>
			<Tooltip content="Show the whole library" placement="right"><button type="button" aria-label="Show the whole library" disabled={!graph} onClick={() => graph?.fitAll()} className={button}><HugeiconsIcon icon={CenterFocusIcon} size={16} /></button></Tooltip>
		</div>
	);
}

/** A short notice over the map, with the one button that undoes what it says. */
function Notice({ children, action, onPress, kind }: { children: ReactNode; action: string; onPress: () => void; kind?: string }) {
	const still = useReducedMotion();
	// A notice on its way out no longer takes room: the map is fitted as if it were gone.
	const leaving = !useIsPresent();
	const hidden = { opacity: 0, y: still ? 0 : -16 };
	return (
		// One line, 2.75 rem high: the map is fitted below the notices by that height. It slides down into place and back up.
		<motion.div role="status" data-evidence-notice={leaving ? undefined : kind} initial={hidden} animate={{ opacity: 1, y: 0 }} exit={hidden} transition={{ duration: still ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }} className={twMerge(PANEL, "flex h-11 items-center gap-3 whitespace-nowrap pl-4 pr-2 text-sm")}>
			<span>{children}</span>
			<button type="button" onClick={onPress} className="shrink-0 rounded-xl bg-black/[0.06] px-3 py-1.5 text-xs font-semibold outline-none hover:bg-black/[0.09] focus-visible:ring-2 focus-visible:ring-accent dark:bg-white/10 dark:hover:bg-white/15">{action}</button>
		</motion.div>
	);
}

/** A paper address that is not on the map: said plainly, with the way back. */
export function Missing({ onClear }: { onClear: () => void }) {
	return (
		// Centred by its wrapper: the notice's own transform is its slide.
		<div className="fixed left-1/2 top-[12.5rem] z-20 -translate-x-1/2 xl:top-28">
			<Notice action="Back to the map" onPress={onClear}>That paper is not on this map.</Notice>
		</div>
	);
}

/**
 * Why the map is faded, over it from 1,280 px wide, centred on the page whichever panels are open: a paper (or every checked
 * paper) brought to the front, and the filter highlighting some papers, one under the other. Each says how to undo it; the map
 * is fitted below them.
 */
export function MapStatus({ focus, highlighted, onShowAll, onClearFilter }: { focus: string | null; highlighted: number | null; onShowAll: () => void; onClearFilter: () => void }) {
	return (
		<div className="fixed left-1/2 top-28 z-20 hidden -translate-x-1/2 flex-col items-center gap-2 xl:flex">
			<AnimatePresence>
				{focus && <Notice key="focus" action="Show the whole map" onPress={onShowAll}><strong className="font-semibold">{focus}</strong> in front</Notice>}
				{highlighted !== null && (
					<Notice key="filter" kind="filter" action="Clear filter" onPress={onClearFilter}>
						<strong className="font-semibold tabular-nums">{highlighted.toLocaleString("en-GB")} {highlighted === 1 ? "paper" : "papers"}</strong> highlighted by the filter
					</Notice>
				)}
			</AnimatePresence>
		</div>
	);
}

/** A paper's line from the labels file, filled in from its record where the file gives no title. */
function mergeLine(label: Label | undefined, record: ListItem | null | undefined): Label | undefined {
	if (label?.title || !record) return label;
	const fromRecord = labelOfRecord(record);
	return { who: label?.who ?? fromRecord.who, year: label?.year ?? fromRecord.year, title: fromRecord.title };
}

/** The record to look up for a pointed paper the labels file gives no title. */
const recordToLookUp = (hover: Hover, label: Label | undefined, more: More | null) => (hover && more && !label?.title ? more.keyOf(hover.index) : null);

/** The paper under the pointer, unless it is the one already open, and its line. */
function usePointedPaper(selected: number | null, more: More | null): { hover: NonNullable<Hover>; line: Label | undefined } | null {
	const pointed = useHover();
	const hover = pointed?.index === selected ? null : pointed;
	const label = hover ? more?.labels.get(hover.index) : undefined;
	const { data: record } = useRecord(recordToLookUp(hover, label, more));
	return hover ? { hover, line: mergeLine(label, record) } : null;
}

/** The paper under the pointer: who, when, what, and its check. A record without a line in the labels file is looked up. */
export function HoverCard({ selected, loaded, more }: { selected: number | null; loaded: Loaded | null; more: More | null }) {
	const pointed = usePointedPaper(selected, more);
	if (!pointed || !loaded) return null;
	return <PointedCard hover={pointed.hover} line={pointed.line ?? { who: " ", year: null }} verdict={loaded.points.verdict[pointed.hover.index]} />;
}

function PointedCard({ hover, line, verdict }: { hover: NonNullable<Hover>; line: Label; verdict: number }) {
	const left = Math.min(hover.x + 16, window.innerWidth - 320);
	return (
		<div className={twMerge(PANEL, "pointer-events-none fixed z-30 w-72 animate-fade-in px-3.5 py-2.5 motion-reduce:animate-none")} style={{ left, top: hover.y + 16 }}>
			<p className="flex items-baseline gap-2 text-xs"><span className="truncate font-semibold">{line.who}</span>{line.year ? <span className={twMerge("tabular-nums", muted)}>{line.year}</span> : null}</p>
			<p className="mt-0.5 line-clamp-3 min-h-[1.25rem] text-sm leading-snug">{line.title ?? " "}</p>
			{verdict ? <div className="mt-2"><VerdictChip verdict={verdict} /></div> : null}
		</div>
	);
}
