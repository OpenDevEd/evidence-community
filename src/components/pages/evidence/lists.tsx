"use client";

import { FlowchartIcon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Pagination } from "@/components/nextui/Pagination";
import type { useFiltersContext } from "@/context/FiltersProvider";
import { twMerge } from "@/lib/tw-merge";
import type { Loaded, More } from "./client";
import { FLAG, VERDICTS, type ChainEntry, type Label } from "./data";
import { css, verdictDot } from "./palette";
import { lineOf, useLines } from "./records";
import { VerdictIcon } from "./verdict-chip";
import { VERDICT, VERDICT_ORDER } from "./verdicts";

export const PANEL = "rounded-2xl bg-white shadow-[0_12px_40px_-12px_rgb(0_0_0/0.25)] dark:bg-secondary-400";
export const muted = "text-black/55 dark:text-white/55";
const ROW = "flex w-full min-w-0 items-start gap-2.5 rounded-xl px-3 py-2 text-left outline-none transition-colors hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/[0.06]";

export type Filters = ReturnType<typeof useFiltersContext>;
export type OnHover = (index: number | null, label?: Label) => void;
/**
 * What the map lights, as the panel lists it: under which heading, its papers in order, the first ones' lines as the search sent
 * them, whether that is all of them yet, and
 * whether the answer on screen is the last search's, or the search failed. `id` changes with the search and the filter.
 */
export type Found = { id: string; title: "Results" | "Filtered"; order: number[]; lines: Map<number, Label>; complete: boolean; loading: boolean; failed: boolean };
/** The whole graph of checked papers: how many there are, whether it is open, and how to open it. */
export type Checked = { count: number; open: boolean; onOpen: () => void };

/** Who and when, with a note at the end, over the title: a row's text. */
function RowText({ who, year, title, aside }: { who: string; year: number | null | undefined; title: string | undefined; aside: string[] }) {
	return (
		<span className="min-w-0 flex-1">
			<span className="flex items-baseline gap-2 text-xs">
				<span className="truncate font-semibold">{who}</span>
				{year ? <span className={twMerge("tabular-nums", muted)}>{year}</span> : null}
				{aside.length ? <span className={twMerge("ml-auto flex shrink-0 gap-2", muted)}>{aside.map((text) => <span key={text}>{text}</span>)}</span> : null}
			</span>
			<span className="mt-0.5 line-clamp-2 text-sm leading-snug">{title ?? " "}</span>
		</span>
	);
}

/** A verdict's name for screen readers, before the row's text. */
const spokenVerdict = (verdict: number) => (verdict ? `${VERDICT[VERDICTS[verdict] as keyof typeof VERDICT].label}: ` : null);

/** One paper in a list: its check, who and when, and its title; the whole row opens it on the map. */
function Row({ index, verdict, label, outside, note, onOpen, onHover, selected }: { index: number; verdict: number; label: Label | undefined; outside: boolean; note?: string; onOpen: () => void; onHover: OnHover; selected?: boolean }) {
	const aside = [outside ? "Outside the library" : "", note ?? ""].filter(Boolean);
	const enter = () => onHover(index, label), leave = () => onHover(null);
	return (
		<li>
			<button type="button" onClick={onOpen} onPointerEnter={enter} onPointerLeave={leave} onFocus={enter} onBlur={leave} className={twMerge(ROW, selected && "bg-accent/10 dark:bg-accent/15")}>
				<span className="mt-0.5 flex w-4 justify-center"><VerdictIcon verdict={verdict} /></span>
				<span className="sr-only">{spokenVerdict(verdict)}</span>
				<RowText who={label?.who ?? "Unknown author"} year={label?.year} title={label?.title} aside={aside} />
			</button>
		</li>
	);
}

export function PaperRow({ index, label, loaded, onOpen, onHover, selected }: { index: number; label: Label | undefined; loaded: Loaded; onOpen: (index: number) => void; onHover: OnHover; selected?: boolean }) {
	return <Row index={index} verdict={loaded.points.verdict[index]} label={label} outside={Boolean(loaded.points.flags[index] & FLAG.outside)} onOpen={() => onOpen(index)} onHover={onHover} selected={selected} />;
}

/** The page numbers' height under a list at 16px text: a small pagination, 32px, in the 10px of padding its focus rings reach into. */
const PAGES_HEIGHT = 52;
/** A paper row's height in a paged list at 16px text: who and when, and two lines of title, so every page holds the same number. */
const PAPER_ROW = 74;
/** Paged lists' paper rows all take a paper row's height. */
const FIXED_ROWS = "[&>li>button]:h-[4.625rem]";
/** A fitted list's rows each take `--row`, their own height plus a share of the space left under the last whole row, centred in it. */
export const FITTED_ROWS = "[&>li]:flex [&>li]:h-[var(--row)] [&>li]:items-center";

/**
 * A list in pages as tall as its box: the box's height (a ResizeObserver, the outside system) sets how many rows of `rowHeight`
 * fit between the list's top and the page numbers, so the numbers sit at the box's foot under a full page on any screen. The
 * server can't know the height, so no row is drawn until the first measure (rows at a guessed height would move), and the list
 * fades in once. The page kept is the
 * one holding the first row shown, so a new size keeps the reader's place. A new `resetOn` (the search and filters the rows come
 * from) starts again from the first page, as the rows are other ones.
 */
export function useFittedPages<T>(items: T[], rowHeight: number, resetOn?: string) {
	const box = useRef<HTMLElement>(null), list = useRef<HTMLOListElement>(null);
	const [fitted, setFitted] = useState<{ size: number; row: number; fits: boolean } | null>(null);
	const [first, setFirst] = useState(0);
	const [rowsOf, setRowsOf] = useState(resetOn);
	if (resetOn !== rowsOf) {
		setRowsOf(resetOn);
		setFirst(0);
	}
	useEffect(() => {
		const element = box.current!, rows = list.current!;
		const observer = new ResizeObserver(() => {
			// A folded sheet has no height: its page size stays as it was.
			if (!element.clientHeight) return;
			// The rows and page numbers are sized in rem: a reader's larger text makes them taller.
			const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;
			const height = rowHeight * rem, room = element.clientHeight - rows.offsetTop - PAGES_HEIGHT * rem;
			const whole = Math.floor(room / height), size = Math.max(3, whole), fits = whole >= 3;
			// The space under the last whole row is shared out between the rows, so the page numbers sit on the box's foot.
			// Rounded down to the 1/64 px browsers lay out in, so the rows' sum never passes the room by a fraction.
			const row = Math.max(height, Math.floor((room / size) * 64) / 64);
			setFitted((was) => (was?.size === size && was.row === row && was.fits === fits ? was : { size, row, fits }));
		});
		observer.observe(element);
		// What sits above the list (a heading whose font arrives late) moves it down without resizing the box.
		for (const above of element.children) if (above !== rows && above.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING) observer.observe(above);
		return () => observer.disconnect();
	}, [rowHeight]);
	const per = fitted?.size ?? 8;
	const pages = Math.max(1, Math.ceil(items.length / per));
	const page = Math.min(Math.floor(first / per) + 1, pages);
	return { boxRef: box, listRef: list, ready: fitted !== null, fits: fitted?.fits ?? true, rowStyle: { "--row": `${fitted?.row ?? rowHeight}px` } as React.CSSProperties, page, pages, per, shown: fitted ? items.slice((page - 1) * per, page * per) : [], setPage: (next: number) => setFirst((next - 1) * per) };
}

/**
 * A paged list's box: positioned, so its list's `offsetTop` is measured from it, and faded in once its page size is known. A page
 * sized to the box never scrolls: a browser's rounding can still leave it a fraction of a pixel over, which a classic scroll bar
 * shows, so it is clipped. Only a box too short for three rows scrolls.
 */
export const fittedBox = (ready: boolean, fits: boolean) => twMerge("relative flex min-h-0 flex-1 flex-col pt-2 transition-opacity duration-200 motion-reduce:transition-none", fits ? "overflow-hidden" : "overflow-y-auto", ready ? "opacity-100" : "opacity-0");

/**
 * What the page shows, at the head of its panel: its name, how many papers and reviews the map holds, and the button that brings
 * every appraised paper to the front, on a grey of its own so it reads apart from the panel under it. Under the phone's sheet
 * heading it goes untitled, on the sheet's white.
 */
export function EvidenceIntro({ papers, reviews, checked, titled = true }: { papers: number; reviews: number; checked: Checked; titled?: boolean }) {
	const stat = (count: number, name: string) => <span><span className="font-semibold tabular-nums text-foreground dark:text-white">{count.toLocaleString("en-GB")}</span> {name}</span>;
	return (
		<div className={twMerge("px-3 pb-2", !titled && "pt-3", titled && "border-b border-black/[0.06] bg-[#e8eaef] pb-3 pt-3 dark:border-white/[0.08] dark:bg-black/25")}>
			{titled && <h1 className="mb-0.5 px-1 font-heading text-lg font-semibold leading-tight tracking-tight">Visualise evidence chains</h1>}
			<p className={twMerge("flex gap-3 px-1 text-xs", muted)}>{stat(papers, "papers")}{stat(reviews, "reviews")}</p>
			<button type="button" aria-pressed={checked.open} onClick={checked.onOpen} className={twMerge("mt-2.5 flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent", checked.open ? "bg-accent text-white" : titled ? "bg-white text-accent shadow-[0_1px_2px_rgb(0_0_0/0.06)] hover:bg-accent/5 dark:bg-secondary-400 dark:text-white dark:hover:bg-white/10" : "bg-accent/10 text-accent hover:bg-accent/15 dark:bg-accent/20 dark:text-white dark:hover:bg-accent/25")}>
				<HugeiconsIcon icon={FlowchartIcon} size={16} aria-hidden className="shrink-0" />
				<span className="min-w-0 flex-1 truncate text-left">Preview appraised papers</span>
				<span className={twMerge("rounded-md px-1.5 py-0.5 text-xs tabular-nums", checked.open ? "bg-white/20" : "bg-accent/10 dark:bg-white/15")}>{checked.count}</span>
			</button>
		</div>
	);
}

/** The meta-analyses and reviews a reader starts from, the most worrying checks first, a page at a time; all of it scrolls. */
export function Chains({ chains, selected, onOpenKey, onHover, heading = true }: { chains: ChainEntry[]; selected: number | null; onOpenKey: (paper: string) => void; onHover: OnHover; heading?: boolean }) {
	const { boxRef, listRef, ...fit } = useFittedPages(chains, PAPER_ROW);
	return (
		<section ref={boxRef} aria-labelledby={heading ? "evidence-chains" : undefined} aria-label={heading ? undefined : "Starting points"} className={fittedBox(fit.ready, fit.fits)}>
			{heading && (
				<h2 id="evidence-chains" className="flex items-baseline justify-between px-5 pb-2 pt-1 text-sm font-semibold">
					Starting points
					<span className={twMerge("text-xs font-medium tabular-nums", muted)}>{chains.length}</span>
				</h2>
			)}
			<ol ref={listRef} style={fit.rowStyle} className={twMerge("px-2", FIXED_ROWS, FITTED_ROWS)}>
				{fit.shown.map((chain) => (
					<Row key={chain.index} index={chain.index} verdict={chain.verdict} label={chain} outside={chain.outside} note={chain.analyses ? undefined : "Not analysed yet"} onOpen={() => onOpenKey(chain.paper)} onHover={onHover} selected={selected === chain.index} />
				))}
			</ol>
			<Pages total={fit.pages} page={fit.page} onChange={fit.setPage} label="Pages of starting points" />
		</section>
	);
}

export function Pages({ total, page, onChange, label, stale }: { total: number; page: number; onChange: (page: number) => void; label: string; stale?: boolean }) {
	if (total <= 1) return null;
	return <div inert={stale} className={twMerge("mt-auto flex justify-center px-3 py-2.5 transition-opacity", stale && "opacity-50")}><Pagination aria-label={label} size="sm" showControls siblings={0} total={total} page={page} onChange={onChange} /></div>;
}

/** What the map lights, a search's results or the filter's papers, a page at a time; all of it scrolls. Each opens on the map. */
export function ResultList({ found, typing, loaded, more, onOpen, onHover }: { found: Found; typing: boolean; loaded: Loaded | null; more: More | null; onOpen: (index: number) => void; onHover: OnHover }) {
	// A list that shrinks under the page a reader is on (the next search's answer) shows its last page, not an empty one.
	const { boxRef, listRef, ready, fits, rowStyle, page, pages, per, shown, setPage } = useFittedPages(found.order, PAPER_ROW);
	// The next page's lines are fetched while this one is read, so turning the page shows it whole.
	useLines(unnamed(found.order.slice(page * per, (page + 1) * per), found.lines, more), more);
	// From the first key typed until the next search's answer arrives, the last one stays in view, dimmed and out of reach.
	const stale = typing || found.loading;
	return (
		<section ref={boxRef} aria-labelledby="evidence-results" aria-busy={stale || undefined} className={fittedBox(ready, fits)}>
			<h2 id="evidence-results" className="flex items-baseline justify-between px-5 pb-2 pt-1 text-sm font-semibold">
				{found.title}
				<span className={twMerge("text-xs font-medium tabular-nums transition-opacity", muted, stale && "opacity-50")}>{found.order.length.toLocaleString("en-GB")}{found.complete ? "" : "+"}</span>
			</h2>
			<ResultRows listRef={listRef} rowStyle={rowStyle} indices={loaded && more ? shown : []} lines={found.lines} stale={stale} loaded={loaded} more={more} onOpen={onOpen} onHover={onHover} />
			{found.failed && <p role="status" className="px-5 text-sm text-danger">The search didn&apos;t answer. Try again in a moment.</p>}
			{!stale && !found.failed && found.order.length === 0 && <p className={twMerge("px-5 text-sm", muted)}>Nothing on the map matches this {found.title === "Results" ? "search" : "filter"}.</p>}
			<Pages total={pages} page={page} onChange={setPage} label="Pages of results" stale={stale} />
		</section>
	);
}

/** The papers of these whose line neither the map's labels nor the search's answer give: their records are looked up. */
const unnamed = (indices: number[], lines: Map<number, Label>, more: More | null) => (more ? indices.filter((i) => !more.labels.get(i)?.title && !lines.has(i)) : []);

/** The page's rows; the list is there before the map's data, empty, so the page size is measured from the first frame. */
function ResultRows({ listRef, rowStyle, indices, lines, stale, loaded, more, onOpen, onHover }: { listRef: Ref<HTMLOListElement>; rowStyle: React.CSSProperties; indices: number[]; lines: Map<number, Label>; stale: boolean; loaded: Loaded | null; more: More | null; onOpen: (index: number) => void; onHover: OnHover }) {
	const records = useLines(unnamed(indices, lines, more), more);
	return (
		<ol ref={listRef} style={rowStyle} inert={stale} className={twMerge("px-2 transition-opacity", FIXED_ROWS, FITTED_ROWS, stale && "opacity-50")}>
			{loaded && more && indices.map((i) => <PaperRow key={i} index={i} label={(!more.labels.get(i)?.title && lines.get(i)) || lineOf(i, more, records)} loaded={loaded} onOpen={onOpen} onHover={onHover} />)}
		</ol>
	);
}

/** How a chain's studies were judged: one bar split by verdict, with each part's count beside its name. */
export function VerdictMeter({ indices, loaded }: { indices: number[]; loaded: Loaded }) {
	const counts = new Map<number, number>();
	for (const i of indices) counts.set(loaded.points.verdict[i], (counts.get(loaded.points.verdict[i]) ?? 0) + 1);
	const unchecked = counts.get(0) ?? 0;
	const order = VERDICT_ORDER.map((name) => VERDICTS.indexOf(name)).filter((v) => counts.get(v));
	return (
		<div className="space-y-2">
			<div className="flex h-2 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10" role="img" aria-label={`${indices.length - unchecked} of ${indices.length} studies checked`}>
				{order.map((v) => <span key={v} className="border-r border-white last:border-r-0 dark:border-black/40" style={{ width: `${(100 * counts.get(v)!) / indices.length}%`, background: css(verdictDot(VERDICTS[v])) }} />)}
			</div>
			<ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
				{order.map((v) => <li key={v} className="inline-flex items-center gap-1"><VerdictIcon verdict={v} size={13} /><span className="font-semibold tabular-nums">{counts.get(v)}</span><span className={muted}>{VERDICT[VERDICTS[v] as keyof typeof VERDICT].label.toLowerCase()}</span></li>)}
				{unchecked ? <li className={muted}><span className="font-semibold tabular-nums">{unchecked}</span> not checked</li> : null}
			</ul>
		</div>
	);
}

export function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
	return (
		<section className="pt-3">
			<h3 className="flex items-baseline justify-between px-5 pb-1 text-xs font-semibold">{title}<span className={twMerge("tabular-nums", muted)}>{count}</span></h3>
			{children}
		</section>
	);
}
