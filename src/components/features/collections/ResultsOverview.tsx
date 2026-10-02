"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowDown01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { FacetDistribution } from "meilisearch";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { twMerge } from "@/lib/tw-merge";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { Button } from "@/components/nextui/Button";
import { PDF_PRESENCE_ATTRIBUTE } from "@/lib/search-filter-constants";
import useSWR from "swr";
import { Link } from "@/i18n/routing";
import { buildItemsQuery, fetcher } from "@/lib/utils";
import { useFiltersContext } from "@/context/FiltersProvider";
import { PdfCover } from "@/components/features/items/PdfCover";
import { Skeleton } from "@/components/nextui/Skeleton";
import type { ItemsGetResponse } from "@/app/api/items/types";

const YEARS_SHOWN = 30;
const CITED_SHOWN = 3;
const TYPES_SHOWN = 6;

const CARD = "w-full bg-card_light dark:bg-card rounded-2xl p-6 flex flex-col gap-4";
const HEADING = "text-lg font-medium text-black/80 dark:text-white/80";

/** A facet value as a row: its share as a bar behind the name, its count at the end, a tick when it is chosen. */
function FacetRow({ label, count, max, selected, onPress }: { label: string; count: number; max: number; selected: boolean; onPress: () => void }) {
	const format = useFormatter();
	return (
		<li>
			<button
				type="button"
				aria-pressed={selected}
				onClick={onPress}
				className={twMerge(
					"relative flex h-10 w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 text-left outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5",
					selected && "text-accent",
				)}
			>
				<span aria-hidden className={twMerge("absolute inset-y-1 left-0 rounded-lg rtl:left-auto rtl:right-0", selected ? "bg-accent/20" : "bg-accent/10")} style={{ width: `${Math.max(2, (count / max) * 100)}%` }} />
				<TruncatedText text={label} className="relative flex-1 text-base font-medium" />
				{selected && <HugeiconsIcon icon={Tick01Icon} aria-hidden className="relative size-4 shrink-0" />}
				<span className="relative shrink-0 text-sm tabular-nums text-black/60 dark:text-white/60">{format.number(count)}</span>
			</button>
		</li>
	);
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
	const max = Math.max(...years.map((year) => counts?.[year] ?? 0), 1);
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
	const readout = hovered !== null ? `${hovered}: ${format.number(counts?.[hovered] ?? 0)}` : null;

	return (
		<section className={CARD} aria-labelledby="results-years">
			<div className="flex items-baseline justify-between gap-4">
				<h4 id="results-years" className={HEADING}>Years</h4>
				{/* One label that the hovered bar replaces, so nothing beside it moves. */}
				<span className="text-sm tabular-nums text-black/60 dark:text-white/60">{readout ?? (chosen ? (chosen[0] === chosen[1] ? chosen[0] : `${chosen[0]}–${chosen[1]}`) : `${first}–${last}`)}</span>
			</div>
			<div
				className="flex h-28 touch-none select-none items-end gap-[2px]"
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
					const count = counts?.[year] ?? 0;
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
							className="group/bar flex h-full flex-1 items-end outline-none focus-visible:ring-2 focus-visible:ring-accent"
						>
							<span
								className={twMerge(
									"block w-full rounded-t-[3px] transition-colors",
									inChosen ? "bg-accent" : chosen ? "bg-accent/25" : "bg-accent/60",
									"group-hover/bar:bg-accent",
								)}
								style={{ height: count ? `${Math.max(3, (count / max) * 100)}%` : "1px" }}
							/>
						</button>
					);
				})}
			</div>
			<div className="-mt-2 flex justify-between text-xs tabular-nums text-black/50 dark:text-white/50">
				<span>{first}</span>
				<span>{last}</span>
			</div>
		</section>
	);
}

function TypeRows({ counts, selected, onSelect, pdf }: { counts: Record<string, number> | undefined; selected: string[]; onSelect: (type: string) => void; pdf: Record<string, number> | undefined }) {
	const typeName = useTranslations("itemType");
	const format = useFormatter();
	const [all, setAll] = useState(false);
	const rows = sortedCounts(counts);
	if (rows.length === 0) return null;
	const max = rows[0][1];
	// Chosen types stay listed even when they are not among the largest.
	const shown = all ? rows : rows.filter(([type], index) => index < TYPES_SHOWN || selected.includes(type));
	const withPdf = pdf?.true ?? 0;
	const total = withPdf + (pdf?.false ?? 0);

	return (
		<section className={CARD} aria-labelledby="results-types">
			<h4 id="results-types" className={HEADING}>Types</h4>
			<ul className="-mx-3 flex flex-col">
				{shown.map(([type, count]) => (
					<FacetRow key={type} label={typeName.has(type) ? typeName(type) : type} count={count} max={max} selected={selected.includes(type)} onPress={() => onSelect(type)} />
				))}
			</ul>
			{rows.length > TYPES_SHOWN && (
				<Button className="w-full" onPress={() => setAll(!all)} endContent={<HugeiconsIcon icon={ArrowDown01Icon} className={twMerge(all && "rotate-180")} />}>
					{all ? "Fewer types" : `All ${rows.length} types`}
				</Button>
			)}
			{total > 0 && (
				<div className="flex flex-col gap-2 pt-2">
					<div className="flex items-baseline justify-between gap-4">
						<span className="text-base font-medium text-black/80 dark:text-white/80">With a PDF</span>
						<span className="text-sm tabular-nums text-black/60 dark:text-white/60">
							{format.number(withPdf)} of {format.number(total)}
						</span>
					</div>
					<meter className="sr-only" min={0} max={total} value={withPdf} />
					<span aria-hidden className="block h-2 overflow-hidden rounded-full bg-accent/15">
						<span className="block h-full rounded-full bg-accent" style={{ width: `${(withPdf / total) * 100}%` }} />
					</span>
				</div>
			)}
		</section>
	);
}

function AuthorRows({ counts, selected, onSelect }: { counts: Record<string, number> | undefined; selected: string; onSelect: (author: string) => void }) {
	const rows = sortedCounts(counts);
	if (rows.length === 0) return null;
	const max = rows[0][1];
	return (
		<section className={CARD} aria-labelledby="results-authors">
			<h4 id="results-authors" className={HEADING}>{selected ? "Author and co-authors" : "Top authors"}</h4>
			<ul className="-mx-3 flex flex-col">
				{rows.map(([name, count]) => (
					<FacetRow key={name} label={name} count={count} max={max} selected={name === selected} onPress={() => onSelect(name)} />
				))}
			</ul>
		</section>
	);
}

/** The most cited of the results in view, three at most. Its box keeps the height of three rows, so the sidebar never moves as they load or change. */
function MostCited() {
	const format = useFormatter();
	const { queryParams } = useFiltersContext();
	const query = buildItemsQuery({ ...queryParams, sort: "mostCited", page: 1 });
	const { data, isValidating } = useSWR<ItemsGetResponse>(
		`${query}${query.includes("?") ? "&" : "?"}limit=${CITED_SHOWN}`,
		fetcher,
		{ keepPreviousData: true, revalidateOnFocus: false },
	);
	const cited = data?.items.filter((item) => item.citationCount) ?? [];

	return (
		<section className={CARD} aria-labelledby="results-cited" aria-busy={isValidating}>
			<h4 id="results-cited" className={HEADING}>Most cited</h4>
			<ol className={twMerge("flex min-h-[16rem] flex-col gap-2 transition-opacity", isValidating && data && "pointer-events-none opacity-50")}>
				{!data &&
					Array.from({ length: CITED_SHOWN }, (_, index) => (
						<li key={index} className="flex gap-4 p-2">
							<Skeleton className="h-16 w-12 shrink-0 rounded-md" />
							<span className="flex flex-1 flex-col gap-2 pt-1">
								<Skeleton className="h-4 w-full rounded-md" />
								<Skeleton className="h-4 w-1/3 rounded-md" />
							</span>
						</li>
					))}
				{data && cited.length === 0 && (
					<li className="text-base text-black/60 dark:text-white/60">Nothing in these results is cited yet.</li>
				)}
				{cited.map((item) => (
					<li key={item.key}>
						<Link href={`/lib/${item.key}`} className="group -mx-2 flex min-w-0 gap-4 rounded-xl p-2 outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5">
							<span className="block w-12 shrink-0 self-start overflow-hidden rounded-md shadow-sm [&_img]:aspect-[3/4] [&_img]:object-cover [&_img]:object-top">
								<PdfCover src={item.attachmentsData?.find((attachment) => attachment.PDFCoverPageImage)?.PDFCoverPageImage} alt="" width={48} title={item.title ?? undefined} />
							</span>
							<span className="flex min-w-0 flex-1 flex-col gap-1">
								<span className="line-clamp-2 text-base font-medium leading-snug text-black/80 transition-colors group-hover:text-accent dark:text-white/80">{item.title || item.key}</span>
								<span className="text-sm tabular-nums text-black/60 dark:text-white/60">
									{format.number(item.citationCount ?? 0)} {item.citationCount === 1 ? "citation" : "citations"}
								</span>
							</span>
						</Link>
					</li>
				))}
			</ol>
		</section>
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
