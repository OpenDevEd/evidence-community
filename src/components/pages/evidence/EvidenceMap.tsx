"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useFiltersContext } from "@/context/FiltersProvider";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { twMerge } from "@/lib/tw-merge";
import { CHECKED, type ChainEntry, type Label, type Theme } from "./data";
import { evidenceClient, type Loaded, type More } from "./client";
import type { EvidenceGraph, Selection } from "./graph";
import { nameOf } from "./overlay";
import { checkedCount, highlightedNow, type CheckCounts } from "./filter";
import type { Found } from "./lists";
import { Controls, HoverCard, MapStatus, Missing, SearchPanel } from "./panels";
import { STAGE } from "./palette";
import { PhoneSheet } from "./phone-sheet";
import { useOpenedName } from "./records";
import { useAddress, useEvidenceGraph, useLighting, useOpened } from "./use-evidence";

/**
 * The evidence map: every paper in the library placed by who cites whom, the evidence map's meta-analyses and their studies
 * on top, coloured by their checks. Search lights papers up; opening one moves its chain into columns in front of the map.
 */
export default function EvidenceMap({ chains, checkCounts, papers }: { chains: ChainEntry[]; checkCounts: CheckCounts; papers: number }) {
	const { theme, smallLayout, stage, labels, searchPanel } = usePageLook();
	const filters = useFiltersContext();
	const [types, setTypes] = useState<ReadonlySet<number>>(new Set());
	const [verdicts, setVerdicts] = useState<ReadonlySet<number>>(new Set());
	// Text typed into the search that has not run yet: the results on screen are already the last search's.
	const [typing, setTyping] = useState(false);
	// Made here, so the React Compiler keeps it the same from render to render: the search box restarts its wait when it changes.
	const onTyped = (text: string | null) => setTyping(text !== null);
	const address = useAddress();
	const { loaded, more, graph, failed, incomplete } = useEvidenceGraph(theme, stage, labels, address);
	const now = useOpened(address, more);
	const { found, lit } = useLighting(filters, loaded, more, types, verdicts);
	const shown = useGraphFollows(graph, failed, now, more, lit);
	const focus = useFocusName(now, shown, more);
	const highlighted = highlightedNow({ checkCounts, types, verdicts, lit, shown });
	useRefitOnNotice(graph, highlighted !== null);
	const { lists, paper, checks, checked } = panelProps({ filters, found, typing, onTyped, loaded, more, chains, now, graph, shown, checkCounts, types, setTypes, verdicts, setVerdicts });
	// The stage's colour is set by class, which the theme sets before the first paint: the server cannot know a reader's theme.
	return (
		<main id="main-content" tabIndex={-1} className="relative h-dvh w-full overflow-hidden bg-[#f5f6f8] outline-none dark:bg-[#0b0e14]">
			<Stage stage={stage} labels={labels} drawn={Boolean(graph)} failed={failed} incomplete={incomplete} />
			<SearchPanel ref={searchPanel} {...lists} onSearch={(text) => { filters.handleSearchChange(text); if (now.target !== null) now.showAll(); }} papers={papers} checked={checked} checks={checks} opened={{ ...paper, deep: Boolean(address.paper && address.view), back: backTo(address, found?.title) }} smallLayout={smallLayout} />
			<PhoneSheet {...lists} {...paper} papers={papers} checked={checked} checks={checks} />
			<Controls graph={graph} />
			<MapStatus focus={focus} highlighted={highlighted} types={types} verdicts={verdicts} onShowAll={now.showAll} onClearFilter={() => { setTypes(new Set()); setVerdicts(new Set()); }} />
			{now.missing && <Missing onClear={now.clear} />}
			<HoverCard selected={now.index} loaded={loaded} more={more} />
		</main>
	);
}

/** The page's theme and layout, and the elements the map is drawn in and fitted between. */
function usePageLook() {
	const theme: Theme = useTheme().resolvedTheme === "dark" ? "dark" : "light";
	const smallLayout = useLibraryConfig().theme.layout === "small";
	// Hooks as statements: the React Compiler caches an object built from its inputs, and a hook inside it would then be skipped.
	const stage = useRef<HTMLDivElement>(null), labels = useRef<HTMLCanvasElement>(null);
	const searchPanel = useRef<HTMLDivElement>(null);
	return { theme, smallLayout, stage, labels, searchPanel };
}

/** Where closing the opened paper goes back to, by name: the appraised papers it was opened from, the results or the filter's papers, or the starting points. */
const backTo = ({ paper, view }: ReturnType<typeof useAddress>, list: Found["title"] | undefined) => (paper && view ? "Appraised papers" : list ?? "Starting points");

/** Where cosmos.gl draws the map, with the canvas for its names over it; it fades in once drawn, or says it cannot be. */
function Stage({ stage, labels, drawn, failed, incomplete }: { stage: RefObject<HTMLDivElement | null>; labels: RefObject<HTMLCanvasElement | null>; drawn: boolean; failed: boolean; incomplete: boolean }) {
	const problem = incomplete ? "Part of the map's data didn't load. Reload the page to try again." : failed ? "This device could not draw the map. Search and the lists still work." : null;
	return (
		<>
			<div className={twMerge("absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none", drawn ? "opacity-100" : "opacity-0")} aria-hidden>
				<div ref={stage} className="absolute inset-0" />
				<canvas ref={labels} className="pointer-events-none absolute inset-0 size-full" />
			</div>
			{problem && <p role="alert" className="absolute inset-x-0 top-1/2 mx-auto max-w-sm -translate-y-1/2 text-center text-sm text-black/60 dark:text-white/60">{problem}</p>}
		</>
	);
}

/**
 * The map follows the page, cosmos.gl being the outside system told: it opens what the address opens, names the opened paper
 * even when the labels file leaves it out, and lights what the search and checks light. Returns the opened paper once the map
 * has opened it.
 */
function useGraphFollows(graph: EvidenceGraph | null, failed: boolean, now: ReturnType<typeof useOpened>, more: More | null, lit: number[] | undefined) {
	const [selection, setSelection] = useState<Selection | null>(null);
	useEffect(() => {
		// Without a map (the graphics card refused), the lists still open papers: their chains and citations come from the data.
		if (!graph && !failed) return;
		let current = true;
		const opening = graph ? graph.select(now.target) : now.target === null ? Promise.resolve(null) : evidenceClient().opened(now.target);
		void opening.then((result) => current && setSelection(result));
		return () => { current = false; };
	}, [graph, failed, now.target]);
	const openedName = useOpenedName(now.index, more);
	useEffect(() => {
		if (graph && now.index !== null && openedName) graph.name(now.index, openedName);
	}, [graph, now.index, openedName]);
	useEffect(() => { graph?.setHighlight(lit); }, [graph, lit]);
	return selection?.index === now.target ? selection : null;
}

/** What the map has brought to the front, by name: the opened paper, or every checked paper. */
function useFocusName(now: ReturnType<typeof useOpened>, shown: Selection | null, more: More | null) {
	const opened = useOpenedName(now.index, more);
	if (!shown) return null;
	if (now.target === CHECKED) return "Appraised papers";
	const label = (now.index !== null && more?.labels.get(now.index)) || opened;
	return label ? nameOf(label) : null;
}

/**
 * The filter's notice over the map, once on the page or gone from it, changes the room for what is in front: cosmos.gl, an outside
 * system, fits it again.
 */
function useRefitOnNotice(graph: EvidenceGraph | null, filterOn: boolean) {
	useEffect(() => { graph?.refit(); }, [graph, filterOn]);
}

type PanelInputs = {
	filters: ReturnType<typeof useFiltersContext>; found: Found | undefined; typing: boolean; onTyped: (text: string | null) => void;
	loaded: Loaded | null; more: More | null; chains: ChainEntry[]; now: ReturnType<typeof useOpened>; graph: EvidenceGraph | null; shown: Selection | null;
	checkCounts: CheckCounts; types: ReadonlySet<number>; setTypes: (next: ReadonlySet<number>) => void; verdicts: ReadonlySet<number>; setVerdicts: (next: ReadonlySet<number>) => void;
};

/** What the side panels and the phone's sheet are given: the lists, the opened paper, the check switches and the checked graph. */
function panelProps({ filters, found, typing, onTyped, loaded, more, chains, now, graph, shown, checkCounts, types, setTypes, verdicts, setVerdicts }: PanelInputs) {
	const onHover = (i: number | null, label?: Label) => graph?.hoverHost(i ?? undefined, label);
	return {
		lists: { filters, found, typing, onTyped, loaded, more, chains, selected: now.index, onOpenKey: now.openKey, onHover },
		paper: { selection: shown, opening: now.target !== null && !shown, loaded, more, onOpen: now.open, onClose: now.close, onHover },
		checks: { counts: checkCounts, types, verdicts, onTypes: setTypes, onVerdicts: setVerdicts },
		checked: { count: checkedCount(checkCounts), open: now.target === CHECKED, onOpen: now.openChecked },
	};
}
