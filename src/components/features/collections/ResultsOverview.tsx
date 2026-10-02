"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowDown01Icon, ArrowRight01Icon, Cancel01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { FacetDistribution } from "meilisearch";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { twMerge } from "@/lib/tw-merge";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { Button } from "@/components/nextui/Button";
import { PDF_PRESENCE_ATTRIBUTE } from "@/lib/search-filter-constants";
import useSWR from "swr";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";
import { Link } from "@/i18n/routing";
import { buildItemsQuery, fetcher } from "@/lib/utils";
import { useFiltersContext } from "@/context/FiltersProvider";
import { PdfCover } from "@/components/features/items/PdfCover";
import { Skeleton } from "@/components/nextui/Skeleton";
import type { ItemsGetResponse } from "@/app/api/items/types";
import type { ListItem } from "@/app/api/item/types";
import { useItemLink } from "@/hooks/useItemLink";
import { useLastFetchedData } from "@/context/Providers";

const YEARS_SHOWN = 30;
const CITED_SHOWN = 3;
const TYPES_SHOWN = 6;

const MUTED = "text-black/60 dark:text-white/60";
// The accent from strong to faint, one step per part, so a part's swatch and its slice of the bar match.
const RAMP = ["bg-accent", "bg-accent/80", "bg-accent/60", "bg-accent/45", "bg-accent/30", "bg-accent/20", "bg-accent/10"];

/**
 * A block of the sidebar in the result cards' language: a white card with a Montserrat heading, and the block's own
 * actions in the tinted band along its foot, where a result card keeps Cite and Copy link.
 */
export function SidebarCard({ id, title, aside, footer, link, children }: { id: string; title: React.ReactNode; aside?: React.ReactNode; footer?: React.ReactNode; link?: { href: string; label: string }; children: React.ReactNode }) {
	return (
		<section aria-labelledby={id} className="w-full rounded-2xl bg-card_light dark:bg-card">
			<div className="flex flex-col gap-5 p-6">
				<div className="flex min-h-8 items-center justify-between gap-4">
					<h4 id={id} className="font-heading text-xl font-medium text-black dark:text-white/80">{title}</h4>
					{aside}
				</div>
				{children}
			</div>
			{(footer || link) && (
				<div className="flex justify-end gap-2 rounded-b-2xl bg-black/[4%] p-2 dark:bg-secondary">
					{footer}
					{link && (
						<Button as={Link} role="link" href={link.href} size="sm" endContent={<HugeiconsIcon icon={ArrowRight01Icon} aria-hidden className="size-3.5" />}>
							{link.label}
						</Button>
					)}
				</div>
			)}
		</section>
	);
}

/** How a list opens and closes in the sidebar: quick out, soft landing, and at once for readers who ask for less motion. */
function useExpandTransition(): Transition {
	return useReducedMotion() ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] };
}

/** A part of the results as a share: whole percents, one decimal below 1%, and "<0.1%" for less. */
export function shareOf(format: ReturnType<typeof useFormatter>, count: number, total: number) {
	const share = count / total;
	if (count > 0 && share < 0.001) return `<${format.number(0.001, { style: "percent", maximumFractionDigits: 1 })}`;
	return format.number(share, { style: "percent", maximumFractionDigits: share < 0.01 ? 1 : 0 });
}

/** A bar's width for a count against the largest: a sliver at least for any count, nothing for none. */
export function barWidth(count: number, largest: number) {
	return count > 0 ? `${Math.max(2, (count / largest) * 100)}%` : "0%";
}

/** How many results a facet's counts are out of: its own base when it is counted without its filter, else all of them. */
export function useFacetTotal(facet: string) {
	const { facetTotals } = useFiltersContext();
	return facetTotals?.[facet] ?? facetTotals?.["*"] ?? 0;
}

function Tick({ shown }: { shown: boolean }) {
	return shown ? <HugeiconsIcon icon={Tick01Icon} aria-hidden className="size-4 shrink-0 text-accent" /> : null;
}

function sortedCounts(counts: Record<string, number> | undefined) {
	return Object.entries(counts ?? {}).filter(([, count]) => count > 0).sort((left, right) => right[1] - left[1]);
}

/** The last thirty years that have results, one bar each. Click a bar for that year, drag across bars for a range, click the chosen year again to clear it. */
function YearBars({ counts, range, onRangeChange }: { counts: Record<string, number> | undefined; range: string; onRangeChange: (start: string | null, end: string | null) => void }) {
	const format = useFormatter();
	const [hovered, setHovered] = useState<number | null>(null);
	const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
	const dragged = useRef(false);
	const known = Object.keys(counts ?? {}).map(Number).filter((year) => Number.isInteger(year) && year > 1000);
	if (known.length === 0) return null;
	const last = Math.max(...known);
	const first = Math.max(Math.min(...known), last - YEARS_SHOWN + 1);
	const years = Array.from({ length: last - first + 1 }, (_, index) => first + index);
	const [rangeStart, rangeEnd] = range.includes("-") ? range.split("-").map(Number) : [Number(range), Number(range)];
	const chosen = drag
		? [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)]
		: range
			? [rangeStart || first, rangeEnd || last]
			: null;
	// A drag over several bars sets a range; the click that ends it must not also pick its first year.
	const commit = () => {
		if (!drag) return;
		setDrag(null);
		if (drag.from === drag.to) return;
		dragged.current = true;
		onRangeChange(String(Math.min(drag.from, drag.to)), String(Math.max(drag.from, drag.to)));
	};
	// Touch keeps sending a drag's events to the bar it began on, so the bar is found by position.
	const yearAt = (event: React.PointerEvent) => {
		const bar = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-year]");
		return bar ? Number(bar.dataset.year) : null;
	};
	const countOf = (year: number) => counts?.[year] ?? 0;
	const peak = years.reduce((best, year) => (countOf(year) > countOf(best) ? year : best), years[0]);
	// The figure on show: the bar pointed at, else the chosen years, else the busiest year, whose bar is marked.
	const readout =
		hovered !== null
			? { value: countOf(hovered), label: `in ${hovered}` }
			: chosen
				? { value: years.filter((year) => year >= chosen[0] && year <= chosen[1]).reduce((sum, year) => sum + countOf(year), 0), label: chosen[0] === chosen[1] ? `in ${chosen[0]}` : `in ${chosen[0]}–${chosen[1]}` }
				: { value: countOf(peak), label: `in ${peak}, the busiest year` };
	const marked = hovered ?? (chosen ? null : peak);
	// Decades name the axis; a span shorter than one names its ends.
	const ticks = new Set(last - first >= 10 ? years.filter((year) => year % 10 === 0) : [first, last]);

	return (
		<SidebarCard
			id="results-years"
			title="Years"
			aside={
				<span className="flex h-8 items-center">
					{range && (
						<Button size="sm" onPress={() => onRangeChange(null, null)} startContent={<HugeiconsIcon icon={Cancel01Icon} aria-hidden className="size-3.5" />}>
							Clear
						</Button>
					)}
				</span>
			}
		>
			<p className="-mt-2 flex items-baseline gap-2" aria-live="polite">
				<span className="font-heading text-3xl font-semibold leading-none tabular-nums">{format.number(readout.value)}</span>
				<span className={`text-sm ${MUTED}`}>{readout.label}</span>
			</p>
			<div>
				<div
					className="flex h-36 touch-none select-none items-end gap-[2px] border-b border-black/10 dark:border-white/10"
					onPointerDown={(event) => {
						dragged.current = false;
						const year = yearAt(event);
						if (year !== null) setDrag({ from: year, to: year });
					}}
					onPointerMove={(event) => {
						const year = yearAt(event);
						if (event.pointerType === "mouse") setHovered(year);
						if (drag && year !== null && year !== drag.to) setDrag({ ...drag, to: year });
					}}
					onPointerLeave={() => {
						setHovered(null);
						commit();
					}}
					onPointerUp={commit}
					onPointerCancel={() => setDrag(null)}
				>
					{years.map((year) => {
						const count = countOf(year);
						const inChosen = chosen && year >= chosen[0] && year <= chosen[1];
						return (
							<button
								key={year}
								type="button"
								aria-label={`${year}: ${format.number(count)}`}
								aria-pressed={Boolean(inChosen)}
								data-year={year}
								onClick={() => {
									if (dragged.current) {
										dragged.current = false;
										return;
									}
									onRangeChange(range === String(year) ? null : String(year), null);
								}}
								className="flex h-full flex-1 items-end outline-none focus-visible:ring-2 focus-visible:ring-accent"
							>
								<span
									className={twMerge(
										"block w-full rounded-t-[4px] transition-colors",
										inChosen || year === marked ? "bg-accent" : chosen ? "bg-accent/25" : "bg-accent/45",
									)}
									style={{ height: count ? `${Math.max(3, (count / countOf(peak)) * 100)}%` : "2px" }}
								/>
							</button>
						);
					})}
				</div>
				<div aria-hidden className="flex gap-[2px] pt-1.5 text-xs tabular-nums text-black/50 dark:text-white/50">
					{years.map((year) => (
						<span key={year} className="relative h-4 flex-1">
							{ticks.has(year) && <span className="absolute left-1/2 -translate-x-1/2">{year}</span>}
						</span>
					))}
				</div>
			</div>
		</SidebarCard>
	);
}

/** Item types as parts of the results: one bar split by type, then a row per type with its swatch, share and count. */
function TypeRows({ counts, selected, onSelect, pdf }: { counts: Record<string, number> | undefined; selected: string[]; onSelect: (type: string) => void; pdf: Record<string, number> | undefined }) {
	const typeName = useTranslations("itemType");
	const format = useFormatter();
	const [all, setAll] = useState(false);
	const expand = useExpandTransition();
	const rows = sortedCounts(counts);
	if (rows.length === 0) return null;
	const total = rows.reduce((sum, [, count]) => sum + count, 0);
	const tone = (index: number) => RAMP[Math.min(index, RAMP.length - 1)];
	const dimmed = (type: string) => selected.length > 0 && !selected.includes(type);
	// Chosen types stay listed even when they are not among the largest; the rest open beneath them.
	const isTop = ([type]: [string, number], index: number) => index < TYPES_SHOWN || selected.includes(type);
	const top = rows.filter(isTop);
	const rest = rows.filter((row, index) => !isTop(row, index));
	const withPdf = pdf?.true ?? 0;
	const withPdfOf = withPdf + (pdf?.false ?? 0);
	const label = (type: string) => (typeName.has(type) ? typeName(type) : type);
	const typeRow = ([type, count]: [string, number]) => {
		const index = rows.findIndex(([key]) => key === type);
		const chosen = selected.includes(type);
		return (
			<li key={type}>
				{/* The ring sits inside the row, so the opening list's clip never cuts it. */}
				<button type="button" aria-pressed={chosen} onClick={() => onSelect(type)} className="flex h-10 w-full min-w-0 items-center gap-3 rounded-xl px-3 text-left outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-white/5">
					<span aria-hidden className={twMerge("size-3 shrink-0 rounded-[4px] transition-opacity", tone(index), dimmed(type) && "opacity-25")} />
					<TruncatedText text={label(type)} className={twMerge("flex-1 text-base font-medium", chosen && "text-accent")} />
					<Tick shown={chosen} />
					<span className={`w-10 shrink-0 text-right text-sm tabular-nums ${MUTED}`}>{shareOf(format, count, total)}</span>
					<span className="w-14 shrink-0 text-right text-base font-bold tabular-nums">{format.number(count)}</span>
				</button>
			</li>
		);
	};

	return (
		<SidebarCard
			id="results-types"
			title="Types"
			footer={
				rows.length > TYPES_SHOWN && (
					<Button size="sm" onPress={() => setAll(!all)} endContent={<HugeiconsIcon icon={ArrowDown01Icon} aria-hidden className={twMerge("size-3.5 transition-transform duration-300 motion-reduce:transition-none", all && "rotate-180")} />}>
						{all ? "Fewer types" : `All ${rows.length} types`}
					</Button>
				)
			}
		>
			<div aria-hidden className="flex h-3 gap-[2px] overflow-hidden rounded-full">
				{rows.map(([type, count], index) => (
					<span key={type} className={twMerge("h-full transition-opacity", tone(index), dimmed(type) && "opacity-25")} style={{ flexGrow: count, flexBasis: 0 }} />
				))}
			</div>
			<div className="-mx-3 -mt-2">
				<ul className="flex flex-col">{top.map(typeRow)}</ul>
				<AnimatePresence initial={false}>
					{all && rest.length > 0 && (
						<motion.ul key="rest" initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={expand} className="flex flex-col overflow-hidden">
							{rest.map(typeRow)}
						</motion.ul>
					)}
				</AnimatePresence>
			</div>
			{withPdfOf > 0 && (
				<div className="flex flex-col gap-2 border-t border-black/5 pt-4 dark:border-white/10">
					<div className="flex items-baseline justify-between gap-4">
						<span className="flex items-baseline gap-2">
							<span className="font-heading text-3xl font-semibold leading-none tabular-nums">{format.number(withPdf / withPdfOf, { style: "percent" })}</span>
							<span className="text-base font-medium">with a PDF</span>
						</span>
						<span className={`text-sm tabular-nums ${MUTED}`}>
							{format.number(withPdf)} of {format.number(withPdfOf)}
						</span>
					</div>
					<meter className="sr-only" min={0} max={withPdfOf} value={withPdf} />
					<span aria-hidden className="block h-2 overflow-hidden rounded-full bg-accent/15">
						<span className="block h-full rounded-full bg-accent" style={{ width: `${(withPdf / withPdfOf) * 100}%` }} />
					</span>
				</div>
			)}
		</SidebarCard>
	);
}

const ACTIVITY_YEARS = 20;

/**
 * When an author published, as one column per year on an axis every row shares, each scaled to the author's own busiest
 * year: the shape says when they were active, the count beside it says how much. Its box is the same before the years
 * arrive, so the row never moves.
 */
function ActivityStrip({ years, axis }: { years: Record<string, number> | undefined; axis: number[] }) {
	const counts = axis.map((year) => years?.[year] ?? 0);
	const busiest = Math.max(0, ...counts);
	const peak = busiest > 0 ? axis[counts.indexOf(busiest)] : null;
	return (
		<span className="flex h-6 w-16 shrink-0 items-end gap-px border-b border-black/10 @[20rem]:w-24 dark:border-white/10">
			{peak !== null && <span className="sr-only">Most results in {peak}</span>}
			{counts.map((count, index) => (
				<span
					key={axis[index]}
					aria-hidden
					className={twMerge("flex-1 rounded-t-[2px] transition-[height] duration-300 motion-reduce:transition-none", axis[index] === peak ? "bg-accent" : "bg-accent/50")}
					style={{ height: count > 0 ? `${Math.max(12, (count / busiest) * 100)}%` : "0%" }}
				/>
			))}
		</span>
	);
}

/** The people with the most results, each with when they published and how much. */
function AuthorRows({ counts, selected, onSelect }: { counts: Record<string, number> | undefined; selected: string; onSelect: (author: string) => void }) {
	const format = useFormatter();
	const { queryParams } = useFiltersContext();
	const rows = sortedCounts(counts);
	const names = rows.map(([name]) => name);
	// The strips ask for themselves after the list, so the list never waits on them.
	const { page, sort, ...filters } = queryParams;
	const base = buildItemsQuery(filters, "/author-activity");
	const { data: activity } = useSWR<Record<string, Record<string, number>>>(
		names.length ? `${base}${base.includes("?") ? "&" : "?"}${names.map((name) => `name=${encodeURIComponent(name)}`).join("&")}` : null,
		fetcher,
		{ keepPreviousData: true, revalidateOnFocus: false },
	);
	if (rows.length === 0) return null;
	// One axis for every row: the last twenty years any of these authors published in.
	const known = names.flatMap((name) => Object.keys(activity?.[name] ?? {}).map(Number)).filter((year) => Number.isInteger(year) && year > 1000);
	const last = known.length ? Math.max(...known) : new Date().getFullYear();
	const axis = Array.from({ length: ACTIVITY_YEARS }, (_, index) => last - ACTIVITY_YEARS + 1 + index);
	return (
		<SidebarCard id="results-authors" title={selected ? "Author and co-authors" : "Top authors"} aside={<span className={`text-xs tabular-nums ${MUTED}`}>{axis[0]}–{last}</span>}>
			<ul className="@container -mx-3 -mt-2 flex flex-col">
				{rows.map(([name, count]) => {
					const chosen = name === selected;
					return (
						<li key={name}>
							<button type="button" aria-pressed={chosen} onClick={() => onSelect(name)} className="flex h-11 w-full min-w-0 items-center gap-3 rounded-xl px-3 text-left outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-white/5">
								<TruncatedText text={name} className={twMerge("flex-1 text-base font-medium", chosen && "text-accent")} />
								<Tick shown={chosen} />
								<ActivityStrip years={activity?.[name]} axis={axis} />
								<span className="w-12 shrink-0 text-right text-base font-bold tabular-nums">{format.number(count)}</span>
							</button>
						</li>
					);
				})}
			</ul>
		</SidebarCard>
	);
}

/**
 * One of the most cited results, linked as a result card links: it loads the page ahead and its covers on approach,
 * and hands its list copy over on click, so the page opens at once from it while the full record loads.
 */
function CitedRow({ item, stale }: { item: ListItem; stale: boolean }) {
	const format = useFormatter();
	// A row kept from the last query while the next one loads must not load its page ahead.
	const link = useItemLink(item, { fullPrefetch: !stale });
	const { setLastFetchedData } = useLastFetchedData();
	const handOff = () => {
		link.onClick();
		setLastFetchedData({ items: [item] } as ItemsGetResponse);
	};
	return (
		<li>
			{/* The list is widened by this row's padding, so its clip never cuts the row's hover. */}
			<Link {...link} onClick={handOff} className="group/row flex min-w-0 gap-4 rounded-xl p-2 outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-white/5">
				<span className="block w-16 shrink-0 self-start overflow-hidden rounded-md shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/row:-translate-y-0.5 motion-reduce:transition-none [&_img]:aspect-[3/4] [&_img]:object-cover [&_img]:object-top">
					<PdfCover src={item.attachmentsData?.find((attachment) => attachment.PDFCoverPageImage)?.PDFCoverPageImage} alt="" width={64} title={item.title ?? undefined} />
				</span>
				<span className="flex min-w-0 flex-1 flex-col gap-1.5">
					<span className="flex items-baseline gap-1.5">
						<span className="font-heading text-2xl font-semibold leading-none tabular-nums">{format.number(item.citationCount ?? 0)}</span>
						<span className={`text-sm ${MUTED}`}>{item.citationCount === 1 ? "citation" : "citations"}</span>
					</span>
					<span className="line-clamp-2 text-base font-medium leading-snug text-black/80 transition-colors group-hover/row:text-accent dark:text-white/80">{item.title || item.key}</span>
				</span>
			</Link>
		</li>
	);
}

/** The most cited of the results in view, three at most. Its box keeps the height of three rows, so the sidebar never moves as they load or change. */
function MostCited() {
	const { queryParams } = useFiltersContext();
	const query = buildItemsQuery({ ...queryParams, sort: "mostCited", page: 1 });
	const { data, error, isValidating, mutate } = useSWR<ItemsGetResponse>(
		`${query}${query.includes("?") ? "&" : "?"}limit=${CITED_SHOWN}`,
		fetcher,
		{ keepPreviousData: true, revalidateOnFocus: false },
	);
	const cited = data?.items.filter((item) => item.citationCount) ?? [];
	// Kept from the last query while the new one loads: dimmed and out of reach until it matches.
	const stale = Boolean(data) && isValidating;

	return (
		<SidebarCard id="results-cited" title="Most cited">
			{/* Three rows of a cover beside its count and a two-line title; every state keeps this height. */}
			<ol aria-busy={isValidating} inert={stale || undefined} className={twMerge("-mx-2 -mt-2 flex h-[20.5rem] flex-col gap-2 overflow-hidden transition-opacity", stale && "opacity-50")}>
				{error && !isValidating && (
					<li className="flex flex-col items-start gap-3 px-2 text-base text-black/60 dark:text-white/60">
						Could not load the most cited results.
						<Button size="sm" onPress={() => void mutate()}>Try again</Button>
					</li>
				)}
				{!data && !error &&
					Array.from({ length: CITED_SHOWN }, (_, index) => (
						<li key={index} className="flex gap-4 p-2">
							<Skeleton className="h-[5.33rem] w-16 shrink-0 rounded-md" />
							<span className="flex flex-1 flex-col gap-2 pt-1">
								<Skeleton className="h-4 w-full rounded-md" />
								<Skeleton className="h-4 w-1/3 rounded-md" />
							</span>
						</li>
					))}
				{data && !error && cited.length === 0 && (
					<li className="px-2 text-base text-black/60 dark:text-white/60">Nothing in these results is cited yet.</li>
				)}
				{!error && cited.map((item) => <CitedRow key={item.key} item={item} stale={stale} />)}
			</ol>
		</SidebarCard>
	);
}

/** What the results under the current search and filters are made of; every row and bar filters the list. */
export function ResultsOverview({
	facetDistribution,
	range,
	types,
	author,
	onRangeChange,
	onTypeSelect,
	onAuthorSelect,
	showYears,
	showAuthors,
}: {
	facetDistribution: FacetDistribution | undefined;
	range: string;
	types: string[];
	author: string;
	onRangeChange: (start: string | null, end: string | null) => void;
	onTypeSelect: (type: string) => void;
	onAuthorSelect: (author: string) => void;
	showYears: boolean;
	showAuthors: boolean;
}) {
	return (
		<>
			{showYears && <YearBars counts={facetDistribution?.year} range={range} onRangeChange={onRangeChange} />}
			<TypeRows counts={facetDistribution?.itemType} selected={types} onSelect={onTypeSelect} pdf={facetDistribution?.[PDF_PRESENCE_ATTRIBUTE]} />
			{showAuthors && <AuthorRows counts={facetDistribution?.fullNames} selected={author} onSelect={onAuthorSelect} />}
			<MostCited />
		</>
	);
}
