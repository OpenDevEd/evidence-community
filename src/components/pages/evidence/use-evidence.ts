import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useEffect, useEffectEvent, useMemo, useState, type RefObject } from "react";
import useSWR from "swr";
import type { ItemsGetResponse } from "@/app/api/items/types";
import type { useFiltersContext } from "@/context/FiltersProvider";
import { listingParams, resultParams, serializeSearchParams } from "@/lib/searchParams";
import { buildItemsQuery, fetcher } from "@/lib/utils";
import { evidenceClient, type Loaded, type More } from "./client";
import { CHECKED, type Theme } from "./data";
import { EvidenceGraph } from "./graph";
import { setHover } from "./hover";
import type { Lit } from "./lists";
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

/** The points a search lit: the set bits of its answer. */
function pointsOf(base64: string) {
	const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	const out: number[] = [];
	bytes.forEach((byte, b) => { for (let k = 0; k < 8; k++) if (byte & (1 << k)) out.push(b * 8 + k); });
	return out;
}

/** The search in the address, or "" without one: the scope every search carries is not a filter of its own. */
function searchQuery(params: ReturnType<typeof useFiltersContext>["queryParams"]) {
	const query = new URLSearchParams(serializeSearchParams(resultParams(params)));
	return [...query.keys()].some((key) => key !== "scope") ? `?${query}` : "";
}

type Hits = { total: number; found: number; lit: number; bits: string };
const bitsOf = (url: string) => fetch(url).then((r) => r.json() as Promise<Hits>);
const once = { revalidateOnFocus: false };

/**
 * Every record the search finds lights up, not only its page of results. The first 5,000 light up at once; when it finds
 * more, all of them follow from a second, slower request. Each answer is one bit per point on the map, so even every paper in
 * the library is a few kilobytes.
 */
function useSearchHits(query: string) {
	const first = useSWR<Hits>(query ? `/api/evidence/hits${query}&limit=5000` : null, bitsOf, { ...once, keepPreviousData: true });
	const all = useSWR<Hits>(restOf(query, first.data), bitsOf, once);
	return newest(first.data, all.data);
}

/** The request for every hit, when the first answer found fewer than the search has. */
function restOf(query: string, first: Hits | undefined) {
	if (!query || !first || first.total <= first.found) return null;
	return `/api/evidence/hits${query}&limit=${first.total}`;
}

/** The fullest answer for the current search: every hit once it is in, the first ones until then. */
const newest = (first: Hits | undefined, all: Hits | undefined) => (all && all.total === first?.total ? all : first);

/** The papers of a check switched on: those whose verdict is one of the switches. */
const withVerdicts = (loaded: Loaded, verdicts: ReadonlySet<number>) => Array.from(loaded.points.verdict.keys()).filter((i) => verdicts.has(loaded.points.verdict[i]));

/** What lights up: the search's papers, the checks' papers, or the papers both light. Nothing lit lights everything. */
function litPoints(fromSearch: number[] | null, fromVerdicts: number[] | null) {
	if (!fromSearch || !fromVerdicts) return fromSearch ?? fromVerdicts ?? undefined;
	const set = new Set(fromVerdicts);
	return fromSearch.filter((i) => set.has(i));
}

/** The search's page of results, how much of it is lit, and what the search and the checks light on the map. */
export function useLighting(filters: ReturnType<typeof useFiltersContext>, loaded: Loaded | null, verdicts: ReadonlySet<number>) {
	const query = searchQuery(filters.queryParams);
	// The list's page of results is fetched only while there is a search: without one the panel lists the evidence chains.
	const results = useSWR<ItemsGetResponse>(query ? buildItemsQuery(listingParams(filters.queryParams), "/items") : null, fetcher, { ...once, keepPreviousData: true });
	const hits = useSearchHits(query);
	const lit = useMemo(() => {
		if (!loaded) return undefined;
		return litPoints(query && hits ? pointsOf(hits.bits) : null, verdicts.size ? withVerdicts(loaded, verdicts) : null);
	}, [loaded, hits, query, verdicts]);
	const litCount: Lit | undefined = query && hits ? { total: hits.total, lit: hits.lit, complete: hits.found >= hits.total } : undefined;
	return { results: query ? results : undefined, lit, litCount };
}
