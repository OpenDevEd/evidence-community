"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useFiltersContext } from "@/context/FiltersProvider";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { twMerge } from "@/lib/tw-merge";
import { CHECKED, type ChainEntry, type Label, type Theme } from "./data";
import type { Loaded, More } from "./client";
import type { EvidenceGraph, Selection } from "./graph";
import type { Lit } from "./lists";
import { Controls, HoverCard, Missing, SearchPanel } from "./panels";
import { PaperPanel } from "./paper";
import { STAGE } from "./palette";
import { PhoneSheet } from "./phone-sheet";
import { useOpenedName } from "./records";
import { useAddress, useEvidenceGraph, useLighting, useOpened } from "./use-evidence";

/**
 * The evidence map: every paper in the library placed by who cites whom, the evidence map's meta-analyses and their studies
 * on top, coloured by their checks. Search lights papers up; opening one moves its chain into columns in front of the map.
 */
export default function EvidenceMap({ chains, verdictCounts }: { chains: ChainEntry[]; verdictCounts: Record<string, number> }) {
	const { theme, smallLayout, stage, labels, searchPanel, paperPanel } = usePageLook();
	const filters = useFiltersContext();
	const [verdicts, setVerdicts] = useState<ReadonlySet<number>>(new Set());
	// Text typed into the search that has not run yet: the results on screen are already the last search's.
	const [typing, setTyping] = useState(false);
	// Made here, so the React Compiler keeps it the same from render to render: the search box restarts its wait when it changes.
	const onTyped = (text: string | null) => setTyping(text !== null);
	const address = useAddress();
	const { loaded, more, graph, failed } = useEvidenceGraph(theme, stage, labels, address);
	const now = useOpened(address, more);
	const { results, lit, litCount } = useLighting(filters, loaded, verdicts);
	const shown = useGraphFollows(graph, now, more, lit);
	const { lists, paper, checks, checked } = panelProps({ filters, results, litCount, typing, onTyped, loaded, more, chains, now, graph, shown, verdictCounts, verdicts, setVerdicts });
	return (
		<main id="main-content" tabIndex={-1} className="relative h-dvh w-full overflow-hidden outline-none" style={{ background: STAGE[theme].background }}>
			<Stage stage={stage} labels={labels} drawn={Boolean(graph)} failed={failed} />
			<SearchPanel ref={searchPanel} {...lists} checked={checked} checks={checks} smallLayout={smallLayout} />
			<PaperPanel ref={paperPanel} {...paper} smallLayout={smallLayout} />
			<PhoneSheet {...lists} {...paper} checked={checked} checks={checks} />
			<Controls graph={graph} />
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
	const searchPanel = useRef<HTMLDivElement>(null), paperPanel = useRef<HTMLDivElement>(null);
	return { theme, smallLayout, stage, labels, searchPanel, paperPanel };
}

/** Where cosmos.gl draws the map, with the canvas for its names over it; it fades in once drawn, or says it cannot be. */
function Stage({ stage, labels, drawn, failed }: { stage: RefObject<HTMLDivElement | null>; labels: RefObject<HTMLCanvasElement | null>; drawn: boolean; failed: boolean }) {
	return (
		<>
			<div className={twMerge("absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none", drawn ? "opacity-100" : "opacity-0")} aria-hidden>
				<div ref={stage} className="absolute inset-0" />
				<canvas ref={labels} className="pointer-events-none absolute inset-0 size-full" />
			</div>
			{failed && <p role="alert" className="absolute inset-x-0 top-1/2 mx-auto max-w-sm -translate-y-1/2 text-center text-sm text-black/60 dark:text-white/60">This device could not draw the map. Search and the lists still work.</p>}
		</>
	);
}

/**
 * The map follows the page, cosmos.gl being the outside system told: it opens what the address opens, names the opened paper
 * even when the labels file leaves it out, and lights what the search and checks light. Returns the opened paper once the map
 * has opened it.
 */
function useGraphFollows(graph: EvidenceGraph | null, now: ReturnType<typeof useOpened>, more: More | null, lit: number[] | undefined) {
	const [selection, setSelection] = useState<Selection | null>(null);
	useEffect(() => {
		if (!graph) return;
		let current = true;
		void graph.select(now.target).then((result) => current && setSelection(result));
		return () => { current = false; };
	}, [graph, now.target]);
	const openedName = useOpenedName(now.index, more);
	useEffect(() => {
		if (graph && now.index !== null && openedName) graph.name(now.index, openedName);
	}, [graph, now.index, openedName]);
	useEffect(() => { graph?.setHighlight(lit); }, [graph, lit]);
	return selection?.index === now.target ? selection : null;
}

type PanelInputs = {
	filters: ReturnType<typeof useFiltersContext>; results: ReturnType<typeof useLighting>["results"]; litCount: Lit | undefined; typing: boolean; onTyped: (text: string | null) => void;
	loaded: Loaded | null; more: More | null; chains: ChainEntry[]; now: ReturnType<typeof useOpened>; graph: EvidenceGraph | null; shown: Selection | null;
	verdictCounts: Record<string, number>; verdicts: ReadonlySet<number>; setVerdicts: (next: ReadonlySet<number>) => void;
};

/** What the side panels and the phone's sheet are given: the lists, the opened paper, the check switches and the checked graph. */
function panelProps({ filters, results, litCount, typing, onTyped, loaded, more, chains, now, graph, shown, verdictCounts, verdicts, setVerdicts }: PanelInputs) {
	const onHover = (i: number | null, label?: Label) => graph?.hoverHost(i ?? undefined, label);
	return {
		lists: { filters, results, lit: litCount, typing, onTyped, loaded, more, chains, selected: now.index, onOpenKey: now.openKey, onHover },
		paper: { selection: shown, opening: now.target !== null && !shown, loaded, more, onOpen: now.open, onClose: now.close, onHover },
		checks: { counts: verdictCounts, selected: verdicts, onChange: setVerdicts },
		checked: { count: Object.values(verdictCounts).reduce((sum, n) => sum + n, 0), open: now.target === CHECKED, onOpen: now.openChecked },
	};
}
