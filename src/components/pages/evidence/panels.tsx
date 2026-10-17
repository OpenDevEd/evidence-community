"use client";

import { CenterFocusIcon, MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import type { ReactNode, Ref } from "react";
import type { ListItem } from "@/app/api/item/types";
import { SearchBar } from "@/components/features/SearchBar";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { filledInputSlots } from "@/components/nextui/field-styles";
import { Tooltip } from "@/components/nextui/Tooltip";
import { twMerge } from "@/lib/tw-merge";
import type { Loaded, More } from "./client";
import type { ChainEntry, Label } from "./data";
import type { EvidenceGraph } from "./graph";
import { useHover, type Hover } from "./hover";
import { MapFilter, type Checks } from "./filter";
import { Chains, muted, PANEL, ResultList, type Checked, type Filters, type Lit, type OnHover, type Results } from "./lists";
import { labelOfRecord, useRecord } from "./records";
import { VerdictChip } from "./verdict-chip";

/** From 1,280 px wide: the search, the checks and the lists in a panel down the left. */
export function SearchPanel({ ref, filters, results, lit, typing, onTyped, loaded, more, chains, checked, checks, selected, onOpenKey, onHover, smallLayout }: { ref: Ref<HTMLDivElement>; filters: Filters; results: Results | undefined; lit: Lit | undefined; typing: boolean; onTyped: (text: string | null) => void; loaded: Loaded | null; more: More | null; chains: ChainEntry[]; checked: Checked; checks: Checks; selected: number | null; onOpenKey: (key: string) => void; onHover: OnHover; smallLayout: boolean }) {
	return (
		<div ref={ref} className={twMerge("pointer-events-none fixed inset-y-0 left-0 z-10 hidden w-[calc(23rem+1rem)] pb-4 pl-4 pt-[calc(7.5rem-1.5rem)] xl:block", smallLayout && "pt-[7.5rem]")}>
			<div className={twMerge(PANEL, "pointer-events-auto flex h-full flex-col overflow-hidden")}>
				<div className="p-2">
					<SearchBar handleSearchChange={filters.handleSearchChange} onTyped={onTyped} search={filters.queryParams.search} classNames={filledInputSlots} />
				</div>
				<div className="border-b border-black/[0.06] px-3 pb-3 dark:border-white/[0.08]">
					<MapFilter {...checks} />
				</div>
				<div className="flex min-h-0 flex-1 flex-col pt-2">
					{results ? (
						<ResultList filters={filters} results={results} lit={lit} typing={typing} more={more} loaded={loaded} onOpenKey={onOpenKey} onHover={onHover} />
					) : (
						<Chains chains={chains} checked={checked} selected={selected} onOpenKey={onOpenKey} onHover={onHover} />
					)}
				</div>
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
function Notice({ children, action, onPress, className, kind }: { children: ReactNode; action: string; onPress: () => void; className?: string; kind?: string }) {
	return (
		// One line, 2.75 rem high: the map is fitted below the notices by that height.
		<div role="status" data-evidence-notice={kind} className={twMerge(PANEL, "flex h-11 animate-fade-in items-center gap-3 whitespace-nowrap pl-4 pr-2 text-sm motion-reduce:animate-none", className)}>
			<span>{children}</span>
			<button type="button" onClick={onPress} className="shrink-0 rounded-xl bg-black/[0.06] px-3 py-1.5 text-xs font-semibold outline-none hover:bg-black/[0.09] focus-visible:ring-2 focus-visible:ring-accent dark:bg-white/10 dark:hover:bg-white/15">{action}</button>
		</div>
	);
}

/** A paper address that is not on the map: said plainly, with the way back. */
export function Missing({ onClear }: { onClear: () => void }) {
	return (
		<Notice action="Back to the map" onPress={onClear} className="fixed left-1/2 top-[12.5rem] z-20 -translate-x-1/2 xl:left-[calc(50%+12rem)] xl:top-28">
			That paper is not on this map.
		</Notice>
	);
}

/**
 * Why the map is faded, over it from 1,280 px wide, centred on the page whichever panels are open: a paper (or every checked
 * paper) brought to the front, and the filter highlighting some papers, one under the other. Each says how to undo it; the map
 * is fitted below them.
 */
export function MapStatus({ focus, highlighted, onShowAll, onClearFilter }: { focus: string | null; highlighted: number | null; onShowAll: () => void; onClearFilter: () => void }) {
	if (!focus && highlighted === null) return null;
	return (
		<div className="fixed left-1/2 top-28 z-20 hidden -translate-x-1/2 flex-col items-center gap-2 xl:flex">
			{focus && <Notice action="Show the whole map" onPress={onShowAll}><strong className="font-semibold">{focus}</strong> in front, the rest faded</Notice>}
			{highlighted !== null && (
				<Notice kind="filter" action="Clear filter" onPress={onClearFilter}>
					<strong className="font-semibold tabular-nums">{highlighted.toLocaleString("en-GB")} {highlighted === 1 ? "paper" : "papers"}</strong> highlighted by the filter
				</Notice>
			)}
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
