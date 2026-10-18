import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useEffect, useEffectEvent, useMemo, useState, type RefObject } from "react";
import useSWR from "swr";
import type { useFiltersContext } from "@/context/FiltersProvider";
import { resultParams, serializeSearchParams } from "@/lib/searchParams";
import { evidenceClient, type Loaded, type More } from "./client";
import { byConcern } from "./atlas";
import { CHECKED, FLAG, type Theme } from "./data";
import { matchesChecks } from "./filter";
import { EvidenceGraph } from "./graph";
import { setHover } from "./hover";
import type { Found } from "./lists";
import { visibleArea } from "./visible-area";

/** A paper in the address: a library record by its key, or a paper outside the library by its DOI. */
function indexOfPaper(paper: string | null, more: More | null) {
	if (!paper || !more) return null;
	if (!paper.startsWith("10.")) return more.indexOf(paper) ?? null;
	for (const [index, doi] of more.doiOf) if (doi === paper) return index;
	return null;
}

/** A point's address: its record's key, or else its DOI. */
const paperOf = (index: number, more: More | null) => more?.keyOf(index) ?? more?.doiOf.get(index) ?? null;

/** The opened paper and the whole graph of checked papers, as the address has them. */
export function useAddress() {
	const [paper, setPaper] = useQueryState("paper", parseAsString.withOptions({ history: "push" }));
	const [view, setView] = useQueryState("view", parseAsStringLiteral(["checked"]).withOptions({ history: "push" }));
	return { paper, setPaper, view, setView };
}
type Address = ReturnType<typeof useAddress>;

/** Closing goes back one step: from a paper to the graph it was opened from, from the graph to the map. */
const closeIn = ({ paper, setPaper, setView }: Address) => void (paper ? setPaper(null) : setView(null));

/** What is open, from the address: a paper, else the whole graph of checked papers, else the map. */
export function useOpened(address: Address, more: More | null) {
	const { paper, view, setPaper, setView } = address;
	const index = indexOfPaper(paper, more);
	return {
		index,
		target: paper ? index : view === "checked" ? CHECKED : null,
		/** A paper address the map does not have. */
		missing: Boolean(paper && more && index === null),
		open: (at: number) => void setPaper(paperOf(at, more)),
		openKey: (key: string) => void setPaper(key),
		openChecked: () => { void setPaper(null); void setView("checked"); },
		close: () => closeIn(address),
		clear: () => void setPaper(null),
		/** Back to the whole map, from a paper or the checked papers. */
		showAll: () => { void setPaper(null); void setView(null); },
	};
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The map, drawn by the graphics card through cosmos.gl, an outside system: made once the data is in, destroyed with the page.
 * A theme change recolours it rather than making it again.
 */
export function useEvidenceGraph(theme: Theme, stage: RefObject<HTMLDivElement | null>, labels: RefObject<HTMLCanvasElement | null>, address: Address) {
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	const [more, setMore] = useState<More | null>(null);
	const [graph, setGraph] = useState<EvidenceGraph | null>(null);
	const [failed, setFailed] = useState(false);
	const [incomplete, setIncomplete] = useState(false);
	// The map calls this from its own clicks, with the address as it is when it is called.
	const select = useEffectEvent((index: number | null) => (index === null ? closeIn(address) : void address.setPaper(paperOf(index, more))));
	useEffect(() => {
		let alive = true, made: EvidenceGraph | null = null;
		const client = evidenceClient(theme);
		const draw = (data: Loaded) => {
			made = new EvidenceGraph(stage.current!, labels.current!, data, reduced(), {
				onHover: (index, screen) => setHover(index === null || !screen ? null : { index, x: screen[0], y: screen[1] }),
				onSelect: (index) => select(index),
				visibleArea: (withPaper) => visibleArea(stage.current, withPaper),
			});
			made.ready.then(() => { if (alive) setGraph(made); }, (error: unknown) => {
				// The graphics card refused after all: said, rather than a map that never appears.
				console.error("Evidence map: the map could not be drawn", error);
				made?.destroy();
				made = null;
				if (alive) setFailed(true);
			});
		};
		// Labels, keys and chains: without them nothing opens, so a failed load is asked for again, then said.
		const rest = (tries = 4): Promise<void> => client.more().then((m) => { if (!alive) return; setMore(m); made?.setMore(m); }, (error: Error) => {
			console.error("Evidence map: labels and chains did not load", error.message);
			if (!alive) return;
			if (tries > 1) window.setTimeout(() => void rest(tries - 1), (5 - tries) * 1000);
			else setIncomplete(true);
		});
		client.loaded.then((data) => {
			if (!alive || !stage.current || !labels.current) return;
			setLoaded(data);
			try { draw(data); } catch (error) { console.error("Evidence map: the map could not be drawn", error); setFailed(true); }
			// Everything else the map uses comes after its first frame.
			(window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 200)))(() => void rest());
		}, () => alive && setFailed(true));
		return () => { alive = false; made?.destroy(); };
		// The map is made once: the theme it starts in is only the first colours' theme.
	}, []);
	useEffect(() => { void graph?.setTheme(theme); }, [graph, theme]);
	return { loaded, more, graph, failed, incomplete };
}

/** The search in the address, or "" without one: the scope every search carries is not a filter of its own. */
function searchQuery(params: ReturnType<typeof useFiltersContext>["queryParams"]) {
	const query = new URLSearchParams(serializeSearchParams(resultParams(params)));
	return [...query.keys()].some((key) => key !== "scope") ? `?${query}` : "";
}

/** A search's answer: how many records it finds, how many of those were looked at, and the map's points among them in its order. */
type Hits = { total: number; found: number; order: number[] };
const hitsOf = (url: string) => fetch(url).then((r) => r.json() as Promise<Hits>);
const once = { revalidateOnFocus: false };

/**
 * Every record on the map the search finds lights up and is listed, not only a page of them. The first 5,000 come at once; when
 * it finds more, all of them follow from a second, slower request.
 */
function useSearchHits(query: string) {
	const first = useSWR<Hits>(query ? `/api/evidence/hits${query}&limit=5000` : null, hitsOf, { ...once, keepPreviousData: true });
	const all = useSWR<Hits>(restOf(query, first.data), hitsOf, once);
	return { hits: newest(first.data, all.data), loading: first.isLoading };
}

/**
 * The papers outside the library a search finds: the library's search cannot see them, so their names on the map are searched
 * here, every word of the search somewhere in the authors or the title.
 */
function outsideMatches(loaded: Loaded | null, more: More | null, text: string) {
	const words = text.toLowerCase().replace(/["()]/g, " ").split(/\s+/).filter((word) => word && !["and", "or", "not"].includes(word));
	if (!loaded || !more || !words.length) return [];
	const found: number[] = [];
	for (let i = 0; i < loaded.points.count; i++) {
		if (!(loaded.points.flags[i] & FLAG.outside)) continue;
		const label = more.labels.get(i);
		const name = `${label?.who ?? ""} ${label?.title ?? ""}`.toLowerCase();
		if (words.every((word) => name.includes(word))) found.push(i);
	}
	return found;
}

/** The request for every hit, when the first answer found fewer than the search has. */
function restOf(query: string, first: Hits | undefined) {
	if (!query || !first || first.total <= first.found) return null;
	return `/api/evidence/hits${query}&limit=${first.total}`;
}

/** The fullest answer for the current search: every hit once it is in, the first ones until then. */
const newest = (first: Hits | undefined, all: Hits | undefined) => (all && all.total === first?.total ? all : first);

/** The papers of a check switched on: those whose verdict is one of the switches. */
const withChecks = (loaded: Loaded, types: ReadonlySet<number>, verdicts: ReadonlySet<number>) => Array.from(loaded.points.verdict.keys()).filter(matchesChecks(loaded, types, verdicts));

/**
 * What the map lights and the panel lists, one list in one order. With a search, the map's papers it finds in its order, those
 * outside the library after them; with the filter on, only what the filter keeps. With the filter alone, the papers it keeps,
 * the most severe checks first, then the most cited. With neither, nothing: the map is lit throughout and the panel lists the
 * starting points.
 */
export function useLighting(filters: ReturnType<typeof useFiltersContext>, loaded: Loaded | null, more: More | null, types: ReadonlySet<number>, verdicts: ReadonlySet<number>) {
	const query = searchQuery(filters.queryParams), search = filters.queryParams.search;
	const { hits, loading } = useSearchHits(query);
	const outside = useMemo(() => (query ? outsideMatches(loaded, more, search) : []), [query, loaded, more, search]);
	const checksOn = types.size + verdicts.size > 0;
	const lit = useMemo(() => {
		if (!loaded) return undefined;
		if (query) return hits ? [...hits.order, ...outside].filter(checksOn ? matchesChecks(loaded, types, verdicts) : () => true) : undefined;
		return checksOn ? withChecks(loaded, types, verdicts).sort(byConcern(loaded.points)) : undefined;
	}, [loaded, hits, outside, query, checksOn, types, verdicts]);
	// A new search or filter starts its list from the first page.
	const id = `${search}|${[...types]}|${[...verdicts]}`;
	const found: Found | undefined = query
		? { id, title: "Results", order: lit ?? [], complete: Boolean(hits && hits.found >= hits.total), loading: loading || !lit }
		: lit ? { id, title: "Filtered", order: lit, complete: true, loading: false } : undefined;
	return { found, lit };
}
