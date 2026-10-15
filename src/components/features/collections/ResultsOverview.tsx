"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { AiMagicIcon, ArrowDown01Icon, ArrowRight01Icon, BalanceScaleIcon, Cancel01Icon, Database02Icon, FileSearchIcon, PercentCircleIcon, Tick01Icon, UserEdit01Icon, UserMultiple02Icon } from "@hugeicons/core-free-icons";
import { FacetDistribution } from "meilisearch";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { twMerge } from "@/lib/tw-merge";
import { HeadFigure, SIDEBAR_GREY, SidebarCard, barWidth } from "./SidebarCard";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { Button } from "@/components/nextui/Button";
import { PDF_PRESENCE_ATTRIBUTE } from "@/lib/search-filter-constants";
import { STUDY_LEVELS, STUDY_TYPES, UNCERTAIN } from "@/lib/readings/study-types";
import { UNSETTLED_TONE, studyTone } from "@/components/features/items/study-tone";
import { studyTypeFacet } from "@/config/library-config/search";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { STUDY_TYPE_TIP, StudyTypeExplanation } from "@/components/features/items/StudyTypeLabel";
import { HINT_CARD, Hint, Tooltip } from "@/components/nextui/Tooltip";
import { Facts } from "@/components/typography/Facts";
import { Accordion, AccordionItem } from "@nextui-org/react";
import { ACCORDION_CONTENT_MOTION, QUESTION_ITEM } from "@/components/nextui/accordion-motion";
import useSWR from "swr";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";
import { Link } from "@/i18n/routing";
import { buildItemsQuery, fetcher } from "@/lib/utils";
import { resultParams } from "@/lib/searchParams";
import { useFiltersContext } from "@/context/FiltersProvider";
import { PdfCover } from "@/components/features/items/PdfCover";
import { Skeleton } from "@/components/nextui/Skeleton";
import type { ItemsGetResponse } from "@/app/api/items/types";
import type { ListItem } from "@/app/api/item/types";
import type { AuthorActivity, TopAuthors } from "@/lib/search";
import { useItemLink } from "@/hooks/useItemLink";
import { useLastFetchedData } from "@/context/Providers";

const YEARS_SHOWN = 30;
const CITED_SHOWN = 3;
const TYPES_SHOWN = 6;

const MUTED = "text-black/60 dark:text-white/60";
// The accent from strong to faint, one step per part, so a part's swatch and its slice of the bar match.
const RAMP = ["bg-accent", "bg-accent/80", "bg-accent/60", "bg-accent/45", "bg-accent/30", "bg-accent/20", "bg-accent/10"];

/** How a list opens and closes in the sidebar: quick out, soft landing, and at once for readers who ask for less motion. */
function useExpandTransition(): Transition {
	return useReducedMotion() ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] };
}

/** A part of the results as a share: whole percents, one decimal below 1%, and "<0.1%" for less. None of nothing is 0%. */
export function shareOf(format: ReturnType<typeof useFormatter>, count: number, total: number) {
	const share = total > 0 ? count / total : 0;
	if (count > 0 && share < 0.001) return `<${format.number(0.001, { style: "percent", maximumFractionDigits: 1 })}`;
	return format.number(share, { style: "percent", maximumFractionDigits: share < 0.01 ? 1 : 0 });
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

type Span = [number, number];

type Translate = ReturnType<typeof useTranslations>;

/** The last thirty years that have results, one per bar, the busiest of them and every year with results; none when no result has a year. */
function yearAxis(counts: Record<string, number> | undefined) {
	const known = Object.keys(counts ?? {}).map(Number).filter((year) => Number.isInteger(year) && year > 1000);
	if (known.length === 0) return null;
	const last = Math.max(...known);
	const earliest = Math.min(...known);
	const first = Math.max(earliest, last - YEARS_SHOWN + 1);
	const years = Array.from({ length: last - first + 1 }, (_, index) => first + index);
	const countOf = (year: number) => counts?.[year] ?? 0;
	const peak = years.reduce((best, year) => (countOf(year) > countOf(best) ? year : best), years[0]);
	return { earliest, first, last, years, known, peak, countOf };
}

/** The years a drag covers, else the chosen range, open ends running to the earliest and latest years with results. */
function chosenSpan(range: string, drag: { from: number; to: number } | null, first: number, last: number): Span | null {
	if (drag) return [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)];
	if (!range) return null;
	const [start, end] = range.includes("-") ? range.split("-").map(Number) : [Number(range), Number(range)];
	return [start || first, end || last];
}

/** The figure on show: the bar pointed at, else the chosen years, else the busiest year. */
function yearReadout(axis: NonNullable<ReturnType<typeof yearAxis>>, hovered: number | null, chosen: Span | null, t: Translate) {
	if (hovered !== null) return { value: axis.countOf(hovered), label: t("inYear", { year: String(hovered) }) };
	if (!chosen) return { value: axis.countOf(axis.peak), label: t("busiestYear", { year: String(axis.peak) }) };
	// Every year with results counts, including those older than the bars.
	const value = axis.known.filter((year) => year >= chosen[0] && year <= chosen[1]).reduce((sum, year) => sum + axis.countOf(year), 0);
	return { value, label: chosen[0] === chosen[1] ? t("inYear", { year: String(chosen[0]) }) : t("inYears", { from: String(chosen[0]), to: String(chosen[1]) }) };
}

/**
 * Picking years on the bars: a click picks a year (and a second click on it clears it), a drag over several bars picks a
 * range. Touch keeps sending a drag's events to the bar it began on, so the bar under the pointer is found by position.
 */
function useYearPicking(range: string, onRangeChange: (start: string | null, end: string | null) => void) {
	const [hovered, setHovered] = useState<number | null>(null);
	const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
	// The click that ends a drag over several bars must not also pick the year it began on.
	const dragged = useRef(false);
	const yearAt = (event: React.PointerEvent) => {
		const bar = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-year]");
		return bar ? Number(bar.dataset.year) : null;
	};
	// The year under the released pointer ends the drag, as its last move may not have rendered yet.
	const commit = (event?: React.PointerEvent) => {
		if (!drag) return;
		const to = (event ? yearAt(event) : null) ?? drag.to;
		setDrag(null);
		if (drag.from === to) return;
		dragged.current = true;
		onRangeChange(String(Math.min(drag.from, to)), String(Math.max(drag.from, to)));
	};
	const surface = {
		onPointerDown: (event: React.PointerEvent) => {
			dragged.current = false;
			const year = yearAt(event);
			if (year !== null) setDrag({ from: year, to: year });
		},
		onPointerMove: (event: React.PointerEvent) => {
			const year = yearAt(event);
			if (event.pointerType === "mouse") setHovered(year);
			if (drag && year !== null && year !== drag.to) setDrag({ ...drag, to: year });
		},
		onPointerLeave: () => {
			setHovered(null);
			commit();
		},
		onPointerUp: (event: React.PointerEvent) => commit(event),
		onPointerCancel: () => setDrag(null),
	};
	const pick = (year: number) => {
		if (dragged.current) {
			dragged.current = false;
			return;
		}
		onRangeChange(range === String(year) ? null : String(year), null);
	};
	return { hovered, drag, surface, pick };
}

function barTone(inChosen: boolean, marked: boolean, anyChosen: boolean) {
	if (inChosen || marked) return "bg-accent";
	return anyChosen ? "bg-accent/25" : "bg-accent/45";
}

/** One bar per year, the busiest or pointed-at one in full and the chosen ones over the rest. */
function YearColumns({ axis, chosen, marked, picking }: { axis: NonNullable<ReturnType<typeof yearAxis>>; chosen: Span | null; marked: number | null; picking: ReturnType<typeof useYearPicking> }) {
	const format = useFormatter();
	const t = useTranslations("sidebar");
	return (
		<div className="flex h-36 touch-none select-none items-end gap-[2px] border-b border-black/10 dark:border-white/10" {...picking.surface}>
			{axis.years.map((year) => {
				const count = axis.countOf(year);
				const inChosen = Boolean(chosen && year >= chosen[0] && year <= chosen[1]);
				return (
					<button
						key={year}
						type="button"
						aria-label={t("yearBar", { year: String(year), count: format.number(count) })}
						aria-pressed={inChosen}
						data-year={year}
						onClick={() => picking.pick(year)}
						className="flex h-full flex-1 items-end outline-none focus-visible:ring-2 focus-visible:ring-accent"
					>
						<span
							className={twMerge("block w-full rounded-t-[4px] transition-colors", barTone(inChosen, year === marked, chosen !== null))}
							style={{ height: count ? `${Math.max(3, (count / axis.countOf(axis.peak)) * 100)}%` : "2px" }}
						/>
					</button>
				);
			})}
		</div>
	);
}

/** Decades name the axis; a span shorter than one names its ends. */
function YearTicks({ axis }: { axis: NonNullable<ReturnType<typeof yearAxis>> }) {
	const ticks = new Set(axis.last - axis.first >= 10 ? axis.years.filter((year) => year % 10 === 0) : [axis.first, axis.last]);
	return (
		<div aria-hidden className="flex gap-[2px] pt-1.5 text-xs tabular-nums text-black/50 dark:text-white/50">
			{axis.years.map((year) => (
				<span key={year} className="relative h-4 flex-1">
					{ticks.has(year) && <span className="absolute left-1/2 -translate-x-1/2">{year}</span>}
				</span>
			))}
		</div>
	);
}

/** The last thirty years that have results, one bar each. Click a bar for that year, drag across bars for a range, click the chosen year again to clear it. */
function YearBars({ counts, range, onRangeChange }: { counts: Record<string, number> | undefined; range: string; onRangeChange: (start: string | null, end: string | null) => void }) {
	const format = useFormatter();
	const t = useTranslations("sidebar");
	const picking = useYearPicking(range, onRangeChange);
	const axis = yearAxis(counts);
	if (!axis) return null;
	const chosen = chosenSpan(range, picking.drag, axis.earliest, axis.last);
	const readout = yearReadout(axis, picking.hovered, chosen, t);
	return (
		<SidebarCard
			title={t("years")}
			// One label that the bar pointed at replaces, so nothing beside it moves.
			band={<HeadFigure value={format.number(readout.value)} label={readout.label} />}
			aside={
				<span className="flex h-8 items-center">
					{range && (
						<Button size="sm" onPress={() => onRangeChange(null, null)} startContent={<HugeiconsIcon icon={Cancel01Icon} aria-hidden className="size-3.5" />}>
							{t("clear")}
						</Button>
					)}
				</span>
			}
		>
			<div>
				<YearColumns axis={axis} chosen={chosen} marked={picking.hovered ?? (chosen ? null : axis.peak)} picking={picking} />
				<YearTicks axis={axis} />
			</div>
		</SidebarCard>
	);
}

const toneOf = (index: number) => RAMP[Math.min(index, RAMP.length - 1)];

/** One type: its swatch, name, share and count; choosing it filters the results. */
function TypeRow({ label, count, total, tone, chosen, dimmed, onSelect, hint }: { label: string; count: number; total: number; tone: string; chosen: boolean; dimmed: boolean; onSelect: () => void; hint?: ReactNode }) {
	const format = useFormatter();
	// The ring sits inside the row, so the opening list's clip never cuts it.
	const row = (
		<button type="button" aria-pressed={chosen} onClick={onSelect} className="flex h-10 w-full min-w-0 items-center gap-3 rounded-xl px-3 text-left outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-white/5">
			<span aria-hidden className={twMerge("size-3 shrink-0 rounded-[4px] transition-opacity", tone, dimmed && "opacity-25")} />
			{/* A row that explains itself shows a cut name in full in its own tooltip, so the name has none of its own. */}
			{hint ? <span className={twMerge("min-w-0 flex-1 truncate text-base font-medium", chosen && "text-accent")}>{label}</span> : <TruncatedText text={label} className={twMerge("flex-1 text-base font-medium", chosen && "text-accent")} />}
			<Tick shown={chosen} />
			<span className={`w-10 shrink-0 text-right text-sm tabular-nums ${MUTED}`}>{shareOf(format, count, total)}</span>
			<span className="w-14 shrink-0 text-right text-base font-bold tabular-nums">{format.number(count)}</span>
		</button>
	);
	return <li>{hint ? <Tooltip content={hint} placement="right" className={STUDY_TYPE_TIP}>{row}</Tooltip> : row}</li>;
}

/**
 * The results' study types as the library counts them: a library that shows uncertain types apart counts them under
 * Uncertain, in place of their types. Types with none are left out unless chosen.
 */
function useStudyTypeCounts(facets: FacetDistribution | undefined, selected: string[]) {
	const { filters } = useLibraryConfig();
	const field = studyTypeFacet(filters);
	const counts = facets?.[field] ?? {};
	const base = useFacetTotal(field);
	const shown = STUDY_TYPES.filter((type) => (counts[type.key] ?? 0) > 0 || selected.includes(type.key));
	const uncertain = counts[UNCERTAIN] ?? 0;
	const showUncertain = uncertain > 0 || selected.includes(UNCERTAIN);
	const read = shown.reduce((sum, type) => sum + (counts[type.key] ?? 0), uncertain);
	return { counts, shown, uncertain, showUncertain, read, unread: Math.max(0, base - read) };
}

/** How study types are read: what the AI reads and the rules it follows, what is typed without it, and what choosing several types shows. */
function StudyTypeMethodRows() {
	const t = useTranslations("studyTypes.method");
	const em = (chunks: ReactNode) => <strong className="font-medium text-black dark:text-white">{chunks}</strong>;
	return (
		<div className="flex flex-col gap-3">
			<Facts
				rows={[
					{ icon: AiMagicIcon, lead: t("ai.lead"), text: t("ai.text") },
					{ icon: BalanceScaleIcon, lead: t("tie.lead"), text: t.rich("tie.text", { em }) },
					{ icon: FileSearchIcon, lead: t("named.lead"), text: t("named.text") },
					{ icon: PercentCircleIcon, lead: t("unsure.lead"), text: t("unsure.text") },
					{ icon: Database02Icon, lead: t("record.lead"), text: t("record.text") },
					{ icon: UserEdit01Icon, lead: t("editor") },
				]}
			/>
			<p className={`border-t border-black/5 pt-3 text-sm leading-6 dark:border-white/10 ${MUTED}`}>{t("several")}</p>
		</div>
	);
}

/** A media query a component follows as the screen changes. */
function mediaQuery(query: string) {
	return {
		subscribe(onChange: () => void) {
			const list = window.matchMedia(query);
			list.addEventListener("change", onChange);
			return () => list.removeEventListener("change", onChange);
		},
		matches: () => window.matchMedia(query).matches,
	};
}

/** Whether the screen matches a media query; false on the server. */
function useMedia(query: ReturnType<typeof mediaQuery>) {
	return useSyncExternalStore(query.subscribe, query.matches, () => false);
}

const WIDE = mediaQuery("(min-width: 1024px)");

/**
 * Where the Study types heading's hover opens: from lg, where the page's sidebar sits beside the results and the card has
 * room beside it, with a pointer that hovers. In Explore, below lg and on touch the accordion does.
 */
const HOVERS = mediaQuery("(min-width: 1024px) and (hover: hover)");

/**
 * The heading as plain text where its hover can't open, below lg or on a screen with no hover: the accordion at the
 * card's foot says the same there. The exact opposite of HOVERS, as the config's max-lg stops at 1023px, which a zoomed
 * window can fall just past.
 */
const NO_HOVER = "[@media_not_all_and_(min-width:1024px)]:no-underline [@media_not_all_and_(min-width:1024px)]:cursor-auto [@media(hover:none)]:no-underline [@media(hover:none)]:cursor-auto";

/**
 * The Study types heading, which explains on hover how types are read, beside the card so the whole window's height is
 * its own. In Explore, a dialog or sheet with no room beside its cards, it is plain text at every width.
 */
function StudyTypesHeading({ card, inExplore }: { card: RefObject<HTMLElement | null>; inExplore: boolean }) {
	const t = useTranslations("studyTypes");
	const hovers = useMedia(HOVERS);
	const content = (
		<div className="flex flex-col gap-3">
			<div>
				<p className="font-heading text-lg font-medium">{t("method.title")}</p>
				<p className={`text-sm leading-6 ${MUTED}`}>{t("method.when")}</p>
			</div>
			<StudyTypeMethodRows />
		</div>
	);
	return <Hint content={content} placement="right-start" anchorRef={card} contentClassName={HINT_CARD} className={inExplore ? "cursor-auto no-underline" : NO_HOVER} isDisabled={inExplore || !hovers}>{t("title")}</Hint>;
}

/** How study types are read as an accordion at the card's foot, only where the heading's hover can't open. */
function StudyTypeMethodAccordion({ inExplore }: { inExplore: boolean }) {
	const t = useTranslations("studyTypes.method");
	const reducedMotion = useReducedMotion();
	return (
		<Accordion className={twMerge("hidden border-t border-black/5 px-0 [@media_not_all_and_(min-width:1024px)]:block dark:border-white/10 [@media(hover:none)]:block", inExplore && "block")} itemClasses={QUESTION_ITEM} disableAnimation={Boolean(reducedMotion)}>
			<AccordionItem key="method" aria-label={t("title")} title={t("title")} subtitle={t("when")} motionProps={{ variants: ACCORDION_CONTENT_MOTION }}>
				<StudyTypeMethodRows />
			</AccordionItem>
		</Accordion>
	);
}

/**
 * What kind of work the results are, as an AI model read them, under the three levels of evidence; choosing a row
 * filters the results, and hovering it says what the type means. Records not read yet are counted apart, and the heading
 * says how types are read on hover, or an accordion at the foot where hovering can't.
 */
function StudyTypeRows({ facets, selected, onSelect, inExplore }: { facets: FacetDistribution | undefined; selected: string[]; onSelect: (type: string) => void; inExplore: boolean }) {
	const t = useTranslations("studyTypes");
	const format = useFormatter();
	const { counts, shown, uncertain, showUncertain, read, unread } = useStudyTypeCounts(facets, selected);
	const card = useRef<HTMLElement>(null);
	if (shown.length === 0 && !showUncertain) return null;
	const dimmed = (key: string) => selected.length > 0 && !selected.includes(key);
	return (
		<SidebarCard
			ref={card}
			title={<StudyTypesHeading card={card} inExplore={inExplore} />}
			aside={<span className={`text-sm tabular-nums ${MUTED}`}>{t("read", { count: read })}</span>}
			band={
				<div aria-hidden className="flex h-3 gap-[2px] overflow-hidden rounded-full">
					{shown.map((type) => (
						<span key={type.key} className={twMerge("h-full transition-opacity", studyTone(type.key), dimmed(type.key) && "opacity-25")} style={{ flexGrow: counts[type.key] ?? 0, flexBasis: 0 }} />
					))}
					{showUncertain && <span className={twMerge("h-full rounded-[2px] transition-opacity", UNSETTLED_TONE, dimmed(UNCERTAIN) && "opacity-25")} style={{ flexGrow: uncertain, flexBasis: 0 }} />}
				</div>
			}
		>
			<div className="-mx-3 -mt-2 flex flex-col gap-3">
				{STUDY_LEVELS.map((level) => {
					const rows = shown.filter((type) => type.level === level.key);
					if (rows.length === 0) return null;
					return (
						<section key={level.key} aria-label={t(`levels.${level.key}`)}>
							<h5 className={`px-3 pb-1 text-sm ${MUTED}`}>{t(`levels.${level.key}`)}</h5>
							<ul className="flex flex-col">
								{rows.map((type) => (
									<TypeRow key={type.key} label={t(`types.${type.key}.plural`)} count={counts[type.key] ?? 0} total={read} tone={studyTone(type.key)} chosen={selected.includes(type.key)} dimmed={dimmed(type.key)} onSelect={() => onSelect(type.key)} hint={<StudyTypeExplanation type={type.key} />} />
								))}
							</ul>
						</section>
					);
				})}
				{showUncertain && (
					<ul className="flex flex-col">
						<TypeRow label={t("uncertainType.label")} count={uncertain} total={read} tone={UNSETTLED_TONE} chosen={selected.includes(UNCERTAIN)} dimmed={dimmed(UNCERTAIN)} onSelect={() => onSelect(UNCERTAIN)} hint={<StudyTypeExplanation type={UNCERTAIN} />} />
					</ul>
				)}
			</div>
			{unread > 0 && selected.length === 0 && (
				<p className="flex items-baseline justify-between gap-4 border-t border-black/5 pt-4 text-sm leading-6 dark:border-white/10"><span className="font-medium">{t("notRead")}</span><span className="tabular-nums">{format.number(unread)}</span></p>
			)}
			<StudyTypeMethodAccordion inExplore={inExplore} />
		</SidebarCard>
	);
}

/** How many of the results have a PDF, as a figure and a meter. */
function PdfShare({ pdf }: { pdf: Record<string, number> | undefined }) {
	const format = useFormatter();
	const t = useTranslations("sidebar");
	const withPdf = pdf?.true ?? 0;
	const withPdfOf = withPdf + (pdf?.false ?? 0);
	if (withPdfOf === 0) return null;
	return (
		<div className="flex flex-col gap-2 border-t border-black/5 pt-4 dark:border-white/10">
			<div className="flex items-baseline justify-between gap-4">
				<span className="flex items-baseline gap-2">
					<span className="font-heading text-3xl font-semibold leading-none tabular-nums">{format.number(withPdf / withPdfOf, { style: "percent" })}</span>
					<span className="text-base font-medium">{t("withPdf")}</span>
				</span>
				<span className={`text-sm tabular-nums ${MUTED}`}>{t("countOf", { count: format.number(withPdf), total: format.number(withPdfOf) })}</span>
			</div>
			<meter className="sr-only" min={0} max={withPdfOf} value={withPdf} />
			<span aria-hidden className="block h-2 overflow-hidden rounded-full bg-accent/15">
				<span className="block h-full rounded-full bg-accent" style={{ width: `${(withPdf / withPdfOf) * 100}%` }} />
			</span>
		</div>
	);
}

/** Item types as parts of the results: one bar split by type, then a row per type with its swatch, share and count. */
function TypeRows({ counts, selected, onSelect, pdf }: { counts: Record<string, number> | undefined; selected: string[]; onSelect: (type: string) => void; pdf: Record<string, number> | undefined }) {
	const typeName = useTranslations("itemType");
	const t = useTranslations("sidebar");
	const [all, setAll] = useState(false);
	const expand = useExpandTransition();
	const rows = sortedCounts(counts);
	if (rows.length === 0) return null;
	const total = rows.reduce((sum, [, count]) => sum + count, 0);
	const dimmed = (type: string) => selected.length > 0 && !selected.includes(type);
	// Chosen types stay listed even when they are not among the largest; the rest open beneath them.
	const isTop = ([type]: [string, number], index: number) => index < TYPES_SHOWN || selected.includes(type);
	const typeRow = ([type, count]: [string, number]) => (
		<TypeRow
			key={type}
			label={typeName.has(type) ? typeName(type) : type}
			count={count}
			total={total}
			tone={toneOf(rows.findIndex(([key]) => key === type))}
			chosen={selected.includes(type)}
			dimmed={dimmed(type)}
			onSelect={() => onSelect(type)}
		/>
	);
	const rest = rows.filter((row, index) => !isTop(row, index));

	return (
		<SidebarCard
			title={t("types")}
			band={
				<div aria-hidden className="flex h-3 gap-[2px] overflow-hidden rounded-full">
					{rows.map(([type, count], index) => (
						<span key={type} className={twMerge("h-full transition-opacity", toneOf(index), dimmed(type) && "opacity-25")} style={{ flexGrow: count, flexBasis: 0 }} />
					))}
				</div>
			}
			footer={rows.length > TYPES_SHOWN && <AllToggle open={all} count={rows.length} onToggle={() => setAll(!all)} />}
		>
			<div className="-mx-3 -mt-2">
				<ul className="flex flex-col">{rows.filter(isTop).map(typeRow)}</ul>
				<AnimatePresence initial={false}>
					{all && rest.length > 0 && (
						<motion.ul key="rest" initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={expand} className="flex flex-col overflow-hidden">
							{rest.map(typeRow)}
						</motion.ul>
					)}
				</AnimatePresence>
			</div>
			<PdfShare pdf={pdf} />
		</SidebarCard>
	);
}

/** Opens the rest of a list and closes it again. */
function AllToggle({ open, count, onToggle }: { open: boolean; count: number; onToggle: () => void }) {
	const t = useTranslations("sidebar");
	return (
		<Button size="sm" onPress={onToggle} endContent={<HugeiconsIcon icon={ArrowDown01Icon} aria-hidden className={twMerge("size-3.5 transition-transform duration-300 motion-reduce:transition-none", open && "rotate-180")} />}>
			{open ? t("fewerTypes") : t("allTypes", { count })}
		</Button>
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
	const t = useTranslations("sidebar");
	return (
		<span className="flex h-6 w-16 shrink-0 items-end gap-px border-b border-black/10 @[20rem]:w-24 dark:border-white/10">
			{peak !== null && <span className="sr-only">{t("mostResultsIn", { year: String(peak) })}</span>}
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

/** The span of years an author published in, and their busiest one. */
function activeSpan(years: Record<string, number> | undefined) {
	const known = Object.entries(years ?? {}).map(([year, count]) => [Number(year), count] as const).filter(([year, count]) => Number.isInteger(year) && year > 1000 && count > 0);
	if (known.length === 0) return null;
	const sorted = known.map(([year]) => year).sort((left, right) => left - right);
	const busiest = known.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
	return { first: sorted[0], last: sorted[sorted.length - 1], peak: busiest[0] };
}

/** A person's or organisation's initials, from the first two words of their name. */
function initialsOf(name: string) {
	return name.replace(/[^\p{L}\s-]/gu, "").split(/[\s-]+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
}

/**
 * The band at the head of the top authors: how many authors the results have, and the ten's publications by year,
 * each publication counted once however many of them wrote it. The author pointed at is drawn over it in full.
 */
function AuthorsBand({ authorCount, combined, focusedYears, axis }: { authorCount: number | undefined; combined: Record<string, number> | undefined; focusedYears: Record<string, number> | undefined; axis: number[] }) {
	const format = useFormatter();
	const t = useTranslations("sidebar");
	const totals = axis.map((year) => combined?.[year] ?? 0);
	const largest = Math.max(1, ...totals);
	const height = (count: number) => (count ? `${Math.max(4, (count / largest) * 100)}%` : "0%");
	return (
		<>
			<p className="flex items-baseline gap-2">
				<span className="font-heading text-3xl font-semibold leading-none tabular-nums">{authorCountLabel(format, authorCount)}</span>
				<span className={`text-sm ${MUTED}`}>{t("authorsInResults", { count: authorCount ?? 0 })}</span>
			</p>
			<span aria-hidden className="flex h-14 items-end gap-[3px]">
				{axis.map((year, index) => (
					<span key={year} className="relative h-full flex-1">
						<span className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-accent/25 transition-[height] duration-300 motion-reduce:transition-none" style={{ height: height(totals[index]) }} />
						<span className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-accent transition-[height] duration-300 motion-reduce:transition-none" style={{ height: height(focusedYears?.[year] ?? 0) }} />
					</span>
				))}
			</span>
		</>
	);
}

/** The facet counts at most 10,000 names, so more reads as "10,000+"; a dash until the count arrives. */
function authorCountLabel(format: ReturnType<typeof useFormatter>, authorCount: number | undefined) {
	if (authorCount === undefined) return "–";
	return authorCount >= 10_000 ? `${format.number(10_000)}+` : format.number(authorCount);
}

/**
 * The top authors under the current search and filters, from a request of their own that the server keeps for a few
 * minutes: ranking authors is the costliest count the sidebar asks for, so the filters' facets never wait on it. Pages
 * and order don't change it. One year axis serves every row and the band: the last twenty years any of them published in.
 */
function useTopAuthors(shown: boolean) {
	const { queryParams } = useFiltersContext();
	const { data, error, isValidating, mutate } = useSWR<TopAuthors>(shown ? buildItemsQuery(resultParams(queryParams), "/top-authors") : null, fetcher, { keepPreviousData: true, revalidateOnFocus: false });
	const byAuthor = new Map(data?.authors.map((entry) => [entry.name, entry]));
	const known = Object.keys(data?.combined ?? {}).map(Number).filter((year) => Number.isInteger(year) && year > 1000);
	const last = known.length ? Math.max(...known) : new Date().getFullYear();
	const axis = Array.from({ length: ACTIVITY_YEARS }, (_, index) => last - ACTIVITY_YEARS + 1 + index);
	// Kept from the last search while the next loads: dimmed and out of reach until it matches.
	return { data, error, isValidating, retry: () => void mutate(), stale: Boolean(data) && isValidating, byAuthor, axis };
}

/** Their profile photo when they have one, else their initials. */
function AuthorBadge({ name, photo, highlighted }: { name: string; photo: string | null; highlighted: boolean }) {
	const tone = photo ? (highlighted ? "ring-2 ring-black/85 dark:ring-white" : "") : highlighted ? "bg-black/85 text-white dark:bg-white dark:text-black" : "bg-accent/15 text-black/80 dark:text-white/80";
	return (
		<span aria-hidden className={twMerge("hidden size-9 shrink-0 items-center justify-center overflow-hidden rounded-full font-heading text-sm font-semibold transition-colors @[24rem]:flex", tone)}>
			{photo ? <Image unoptimized src={photo} alt="" width={36} height={36} className="size-full object-cover" /> : initialsOf(name)}
		</span>
	);
}

/** An author's strip, with how many results they share with the author pointed at over it; one who shares none fades. */
function StripWithShared({ years, axis, shared, focused }: { years: Record<string, number> | undefined; axis: number[]; shared: number | null; focused: string | null }) {
	const format = useFormatter();
	const t = useTranslations("sidebar");
	return (
		<span className="relative flex shrink-0">
			<span className={twMerge("flex transition-opacity duration-200 motion-reduce:transition-none", shared === 0 && "opacity-25", shared ? "opacity-30" : "")}>
				<ActivityStrip years={years} axis={axis} />
			</span>
			{shared ? (
				<span className="absolute inset-0 flex items-center justify-center">
					<span className="flex items-center gap-1 rounded-full bg-black/85 px-2 py-0.5 text-xs font-semibold tabular-nums text-white dark:bg-white dark:text-black">
						<HugeiconsIcon icon={UserMultiple02Icon} aria-hidden className="size-3.5" />
						{format.number(shared)}
						<span className="sr-only">{t("togetherWith", { name: focused ?? "" })}</span>
					</span>
				</span>
			) : null}
		</span>
	);
}

/** One author: badge, name and institution, when they published, and how many results; choosing them filters by them. */
function AuthorRow({ author, axis, chosen, focused, shared, onSelect, onFocus }: { author: AuthorActivity; axis: number[]; chosen: boolean; focused: string | null; shared: number | null; onSelect: () => void; onFocus: () => void }) {
	const format = useFormatter();
	const highlighted = focused === author.name;
	return (
		<li>
			<button type="button" aria-pressed={chosen} onClick={onSelect} onPointerEnter={onFocus} onFocus={onFocus} className={twMerge("flex h-14 w-full min-w-0 items-center gap-3 rounded-xl px-3 text-left outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-white/5", highlighted && "bg-black/5 dark:bg-white/5")}>
				<AuthorBadge name={author.name} photo={author.photo} highlighted={chosen || highlighted} />
				<span className="flex min-w-0 flex-1 flex-col">
					<TruncatedText text={author.name} className={twMerge("text-base font-medium leading-5", chosen && "text-accent")} />
					<span className={`h-4 truncate text-xs leading-4 ${MUTED}`}>{author.institution ?? ""}</span>
				</span>
				<Tick shown={chosen} />
				<StripWithShared years={author.years} axis={axis} shared={shared} focused={focused} />
				<span className="w-12 shrink-0 text-right text-base font-bold tabular-nums">{format.number(author.count)}</span>
			</button>
		</li>
	);
}

/** Ten placeholder rows, the room the answer will take. */
function AuthorPlaceholders() {
	return (
		<ul aria-hidden className="flex flex-col">
			{Array.from({ length: 10 }, (_, index) => (
				<li key={index} className="flex h-14 items-center gap-3 px-3">
					<Skeleton className="h-4 flex-1 rounded-md" />
					<Skeleton className="h-6 w-24 rounded-md" />
					<Skeleton className="h-4 w-10 rounded-md" />
				</li>
			))}
		</ul>
	);
}

/** A card's failure, with a way to ask again. */
function LoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
	const t = useTranslations("sidebar");
	return (
		<div className={`flex flex-col items-start gap-3 px-3 text-base ${MUTED}`}>
			{message}
			<Button size="sm" onPress={onRetry}>{t("tryAgain")}</Button>
		</div>
	);
}

/** The list in whichever state it is in: failed, loading, empty, or the authors. */
function AuthorList({ authors, focus, selected, onSelect }: { authors: ReturnType<typeof useTopAuthors>; focus: [string | null, (name: string | null) => void]; selected: string; onSelect: (author: string) => void }) {
	const [focused, setFocused] = focus;
	const t = useTranslations("sidebar");
	if (authors.error && !authors.isValidating) return <LoadFailure message={t("authorsFailed")} onRetry={authors.retry} />;
	if (!authors.data) return <AuthorPlaceholders />;
	if (authors.data.authors.length === 0) return <p className={`px-3 text-base ${MUTED}`}>{t("noAuthors")}</p>;
	const together = focused ? authors.byAuthor.get(focused)?.together : undefined;
	return (
		<ul inert={authors.stale || undefined} className={twMerge("@container flex flex-col transition-opacity", authors.stale && "opacity-50")} onPointerLeave={() => setFocused(null)} onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setFocused(null)}>
			{authors.data.authors.map((author) => (
				<AuthorRow
					key={author.name}
					author={author}
					axis={authors.axis}
					chosen={author.name === selected}
					focused={focused}
					shared={focused && author.name !== focused ? (together?.[author.name] ?? 0) : null}
					onSelect={() => onSelect(author.name)}
					onFocus={() => setFocused(author.name)}
				/>
			))}
		</ul>
	);
}

/** The header's label: the axis's years, or the span and busiest year of the author pointed at. */
function spanLabel(span: ReturnType<typeof activeSpan>, axis: number[], t: Translate) {
	if (!span) return `${axis[0]}–${axis[axis.length - 1]}`;
	return t("authorSpan", { span: span.first === span.last ? String(span.first) : `${span.first}–${span.last}`, year: String(span.peak) });
}

/**
 * The people with the most results: who they are and where they publish from, when they published, and how much.
 * Pointing at one (or focusing it) shows their span of years in the header, draws their years in the band, and, over
 * the strips of the others, how many results each shares with them.
 */
function AuthorRows({ selected, onSelect, shown }: { selected: string; onSelect: (author: string) => void; shown: boolean }) {
	const [focused, setFocused] = useState<string | null>(null);
	const t = useTranslations("sidebar");
	const authors = useTopAuthors(shown);
	const focusedYears = focused ? authors.byAuthor.get(focused)?.years : undefined;
	return (
		<SidebarCard
			title={selected ? t("authorAndCoauthors") : t("topAuthors")}
			// One label that the author pointed at replaces, so nothing beside it moves.
			aside={
				<span className={`text-xs tabular-nums ${MUTED}`} aria-live="polite">
					{spanLabel(focused ? activeSpan(focusedYears) : null, authors.axis, t)}
				</span>
			}
			band={<AuthorsBand authorCount={authors.data?.authorCount} combined={authors.data?.combined} focusedYears={focusedYears} axis={authors.axis} />}
		>
			{/* Always the room of ten rows, whatever the answer, so the card never grows or shrinks as it arrives. */}
			<div className="-mx-3 -my-3 h-[35rem]">
				<AuthorList authors={authors} focus={[focused, setFocused]} selected={selected} onSelect={onSelect} />
			</div>
		</SidebarCard>
	);
}

/**
 * One of the most cited results, linked as a result card links: it loads the page ahead and its covers on approach,
 * and hands its list copy over on click, so the page opens at once from it while the full record loads.
 */
function CitedRow({ item, stale }: { item: ListItem; stale: boolean }) {
	const format = useFormatter();
	const t = useTranslations("sidebar");
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
						<span className={`text-sm ${MUTED}`}>{t("citations", { count: item.citationCount ?? 0 })}</span>
					</span>
					<span className="line-clamp-2 text-base font-medium leading-snug text-black/80 transition-colors group-hover/row:text-accent dark:text-white/80">{item.title || item.key}</span>
				</span>
			</Link>
		</li>
	);
}

function CitedPlaceholders() {
	return Array.from({ length: CITED_SHOWN }, (_, index) => (
		<li key={index} className="flex gap-4 p-2">
			<Skeleton className="h-[5.33rem] w-16 shrink-0 rounded-md" />
			<span className="flex flex-1 flex-col gap-2 pt-1">
				<Skeleton className="h-4 w-full rounded-md" />
				<Skeleton className="h-4 w-1/3 rounded-md" />
			</span>
		</li>
	));
}

/** The most cited of the results in view, three at most, as the results list would sort them by citations. */
function useMostCited(shown: boolean) {
	const { queryParams } = useFiltersContext();
	const query = buildItemsQuery({ ...resultParams(queryParams), sort: "mostCited", page: 1 });
	const { data, error, isValidating, mutate } = useSWR<ItemsGetResponse>(shown ? `${query}${query.includes("?") ? "&" : "?"}perPage=${CITED_SHOWN}` : null, fetcher, { keepPreviousData: true, revalidateOnFocus: false });
	// Kept from the last query while the new one loads: dimmed and out of reach until it matches.
	return { data, failed: Boolean(error) && !isValidating, isValidating, retry: () => void mutate(), stale: Boolean(data) && isValidating, cited: data?.items.filter((item) => item.citationCount) ?? [] };
}

/** The list in whichever state it is in: failed, loading, nothing cited, or the results. */
function CitedList({ cited }: { cited: ReturnType<typeof useMostCited> }) {
	const t = useTranslations("sidebar");
	if (cited.failed) {
		return (
			<li className="flex flex-col items-start gap-3 px-2 text-base text-black/60 dark:text-white/60">
				{t("citedFailed")}
				<Button size="sm" onPress={cited.retry}>{t("tryAgain")}</Button>
			</li>
		);
	}
	if (!cited.data) return <CitedPlaceholders />;
	if (cited.cited.length === 0) return <li className="px-2 text-base text-black/60 dark:text-white/60">{t("noCited")}</li>;
	return cited.cited.map((item) => <CitedRow key={item.key} item={item} stale={cited.stale} />);
}

/** The most cited of the results in view, three at most. Its box keeps the height of three rows, so the sidebar never moves as they load or change. */
function MostCited({ shown }: { shown: boolean }) {
	const cited = useMostCited(shown);
	const t = useTranslations("sidebar");
	return (
		<SidebarCard title={t("mostCited")}>
			{/* Three rows of a cover beside its count and a two-line title; every state keeps this height. */}
			<ol aria-busy={cited.isValidating} inert={cited.stale || undefined} className={twMerge("-mx-2 -mt-2 flex h-[20.5rem] flex-col gap-2 overflow-hidden transition-opacity", cited.stale && "opacity-50")}>
				<CitedList cited={cited} />
			</ol>
		</SidebarCard>
	);
}

/**
 * Whether this sidebar is on screen: the page's own shows from the lg breakpoint, where CSS stops hiding it, and
 * Explore's whenever it is open. Below lg the page's copy stays mounted but hidden, so it must not ask for its own figures.
 */
function useShown(inExplore: boolean) {
	const wide = useMedia(WIDE);
	return inExplore || wide;
}

/** What the results under the current search and filters are made of; every row and bar filters the list. */
export function ResultsOverview({
	facetDistribution,
	range,
	types,
	studies,
	author,
	onRangeChange,
	onTypeSelect,
	onStudySelect,
	onAuthorSelect,
	showYears,
	showAuthors,
	inExplore,
}: {
	facetDistribution: FacetDistribution | undefined;
	range: string;
	types: string[];
	studies: string[];
	author: string;
	onRangeChange: (start: string | null, end: string | null) => void;
	onTypeSelect: (type: string) => void;
	onStudySelect: (type: string) => void;
	onAuthorSelect: (author: string) => void;
	showYears: boolean;
	showAuthors: boolean;
	inExplore: boolean;
}) {
	const shown = useShown(inExplore);
	return (
		<>
			{showYears && <YearBars counts={facetDistribution?.year} range={range} onRangeChange={onRangeChange} />}
			<TypeRows counts={facetDistribution?.itemType} selected={types} onSelect={onTypeSelect} pdf={facetDistribution?.[PDF_PRESENCE_ATTRIBUTE]} />
			<StudyTypeRows facets={facetDistribution} selected={studies} onSelect={onStudySelect} inExplore={inExplore} />
			{showAuthors && <AuthorRows selected={author} onSelect={onAuthorSelect} shown={shown} />}
			<MostCited shown={shown} />
		</>
	);
}
