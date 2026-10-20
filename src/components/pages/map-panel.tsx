"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";
import { SearchBar } from "@/components/features/SearchBar";
import { Tab, Tabs } from "@/components/nextui/Tabs";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { CountryFlag } from "@/components/statistics/CountryFlag";
import { COUNTRY_PARAMS } from "@/constants/misc";
import type { useItemsList } from "@/hooks/useItemsList";
import { twMerge } from "@/lib/tw-merge";
import { RAISED_INPUT } from "./evidence/filter";
import { MEASURES, type CountryRow, type Measure } from "./map-measure";
import { FITTED_ROWS, fittedBox, muted, PANEL, Pages, useFittedPages } from "./evidence/lists";
import { SHEET, SheetBar } from "./evidence/phone-sheet";

type Props = ReturnType<typeof useItemsList>;

/** The measure, in the address as `?count=records`; records per million people unless it says otherwise. */
export function useMeasure() {
	return useQueryState("count", parseAsStringLiteral(MEASURES).withDefault("people"));
}

/** A value as the list and the tooltip show it: whole records, or a rate to three figures. */
export function useValueFormat() {
	const format = useFormatter();
	return {
		rate: (value: number) => format.number(value, value >= 100 ? { maximumFractionDigits: 0 } : { maximumSignificantDigits: 3 }),
		count: (value: number) => format.number(value),
	};
}


/** The page's head, in the panel's darkest grey: what it is, how many countries, and what their colours count. */
function MapIntro({ countries, measure, onMeasure, titled = true }: { countries: number; measure: Measure; onMeasure: (next: Measure) => void; titled?: boolean }) {
	const t = useTranslations("ui");
	return (
		<div className={twMerge("px-3 pb-3 pt-3", titled && "border-b border-black/[0.06] bg-[#e8eaef] dark:border-white/[0.08] dark:bg-black/25")}>
			{titled && <h1 className="mb-0.5 px-1 font-heading text-lg font-semibold leading-tight tracking-tight">{t("mapTitle")}</h1>}
			{titled && <p className={twMerge("px-1 text-xs", muted)}>{t.rich("mapCountryCount", { count: countries, number: (value) => <span className="font-semibold tabular-nums text-foreground dark:text-white">{value}</span> })}</p>}
			<Tabs aria-label={t("mapColourBy")} selectedKey={measure} onSelectionChange={(key) => onMeasure(key as Measure)} classNames={{ base: "mt-2.5", tabList: "w-full md:w-full", tab: "flex-1 md:flex-1" }}>
				<Tab key="people" title={t("mapPerMillion")} />
				<Tab key="records" title={t("mapTotal")} />
			</Tabs>
		</div>
	);
}

/** A country row's height: name over its bar. */
const COUNTRY_ROW = 48;

/** How a row's value reads: a rate or a count, or that the country's population isn't known. */
function RowValue({ value, measure }: { value: number | null; measure: Measure }) {
	const { rate, count } = useValueFormat();
	const t = useTranslations("ui");
	if (value === null) return <span className={twMerge("min-w-[4.5rem] shrink-0 whitespace-nowrap text-right text-xs font-medium", muted)}>{t("mapNoData")}</span>;
	return <span className="min-w-[4.5rem] shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums">{measure === "people" ? rate(value) : count(value)}</span>;
}

/** The top value, which the bars are shares of. */
const topOf = (rows: CountryRow[]) => rows[0]?.value || 1;

/** A bar's width: the country's true share of the top one, at least a sliver, none without a value. Only the map's colour is capped. */
const barShare = (value: number | null, top: number) => (value === null ? 0 : Math.max(2, (100 * value) / top));

type RowEvents = { onHover: (code: string | null) => void; onSelect: (code: string) => void };

/** One country: its rank, flag and name over its bar, and its value. Pointing at it lifts it on the map; choosing it shows its records. */
function CountryRowButton({ row, rank, selected, lifted, top, measure, tint, onHover, onSelect }: RowEvents & { row: CountryRow; rank: number; selected: boolean; lifted: boolean; top: number; measure: Measure; tint: (value: number | null) => string }) {
	return (
		<button type="button" aria-pressed={selected} onPointerEnter={() => onHover(row.code)} onFocus={() => onHover(row.code)} onBlur={() => onHover(null)} onClick={() => onSelect(row.code)} className={twMerge("flex h-12 w-full min-w-0 items-center gap-3 rounded-xl px-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent", lifted && "bg-black/[0.04] dark:bg-white/[0.06]", selected && "bg-accent/10 font-semibold dark:bg-accent/15")}>
			<span className={twMerge("w-5 shrink-0 text-right text-xs font-normal tabular-nums", muted)}>{rank}</span>
			<CountryFlag countryCode={row.code} className="h-3.5 w-5 shrink-0 rounded-[3px]" />
			<span className="flex min-w-0 flex-1 flex-col gap-1.5">
				<TruncatedText text={row.name} className={twMerge("text-sm", !selected && "font-medium")} />
				<span aria-hidden className="block h-1 rounded-full bg-black/5 dark:bg-white/10">
					<span className="block h-full rounded-full" style={{ width: `${barShare(row.value, top)}%`, background: tint(row.value) }} />
				</span>
			</span>
			<RowValue value={row.value} measure={measure} />
		</button>
	);
}

/** The list's heading: what it is, and what its numbers count. */
function CountriesHeading({ measure }: { measure: Measure }) {
	const t = useTranslations("ui");
	return (
		<h2 id="map-countries" className="flex items-baseline justify-between px-5 pb-2 pt-1 text-sm font-semibold">
			{t("countries")}
			<span className={twMerge("text-xs font-medium", muted)}>{measure === "people" ? t("mapUnitPeople") : t("resources")}</span>
		</h2>
	);
}

/**
 * The library's countries by the chosen measure, a page at a time. The list is the map's key: each bar has its country's colour.
 * Pointing at a row lifts its country on the map; choosing one shows its records, and a chosen one stays marked.
 */
function CountryList({ rows, chosen, stale, measure, tint, hovered, onHover, onSelect, heading = true }: RowEvents & { rows: CountryRow[]; chosen: string[]; /** The counts are the last search's until the new ones arrive: dimmed and out of reach. */ stale: boolean; measure: Measure; tint: (value: number | null) => string; hovered: string | null; heading?: boolean }) {
	const { boxRef, listRef, ...fit } = useFittedPages(rows, COUNTRY_ROW);
	const t = useTranslations("ui");
	// Under its heading it is named by it; in the phone's sheet, whose bar says it, by its own label.
	const named = heading ? { "aria-labelledby": "map-countries" } : { "aria-label": t("countries") };
	return (
		<section ref={boxRef} {...named} className={fittedBox(fit.ready, fit.fits)}>
			{heading && <CountriesHeading measure={measure} />}
			<ol ref={listRef} inert={stale} style={fit.rowStyle} className={twMerge("px-2 transition-opacity", FITTED_ROWS, stale && "opacity-50")} onPointerLeave={() => onHover(null)}>
				{fit.shown.map((row, k) => (
					<li key={row.code}>
						<CountryRowButton row={row} rank={(fit.page - 1) * fit.per + k + 1} selected={chosen.includes(COUNTRY_PARAMS[row.code])} lifted={hovered === row.code} top={topOf(rows)} measure={measure} tint={tint} onHover={onHover} onSelect={onSelect} />
					</li>
				))}
			</ol>
			<Pages total={fit.pages} page={fit.page} onChange={fit.setPage} label={t("mapCountryPages")} stale={stale} />
		</section>
	);
}

export type PanelProps = { props: Props; rows: CountryRow[]; measure: Measure; onMeasure: (next: Measure) => void; tint: (value: number | null) => string; hovered: string | null; onHover: (code: string | null) => void; onSelect: (code: string) => void; smallLayout: boolean };

/** The search, raised in white on the band's grey. */
function Search({ props }: { props: Props }) {
	return <SearchBar handleSearchChange={props.handleSearchChange} search={props.queryParams.search} classNames={RAISED_INPUT} />;
}

/** From 1,280 px wide, one panel down the left, as on the evidence map: the head, the search band, then the countries. */
export function MapPanel(p: PanelProps) {
	return (
		<div className={twMerge("pointer-events-none fixed inset-y-0 left-0 z-10 hidden w-[calc(23rem+1rem)] pb-4 pl-4 pt-[calc(7.5rem-1.5rem)] xl:block", p.smallLayout && "pt-[7.5rem]")}>
			<div className={twMerge(PANEL, "pointer-events-auto flex h-full flex-col overflow-hidden")}>
				<MapIntro countries={p.rows.length} measure={p.measure} onMeasure={p.onMeasure} />
				<div className="relative z-10 border-b border-black/[0.06] bg-[#f2f3f6] p-3 dark:border-white/[0.08] dark:bg-black/10"><Search props={p.props} /></div>
				<CountryList rows={p.rows} chosen={p.props.queryParams.country} stale={Boolean(p.props.isFacetsFetching)} measure={p.measure} tint={p.tint} hovered={p.hovered} onHover={p.onHover} onSelect={p.onSelect} />
			</div>
		</div>
	);
}

/** Lying on its side below 1,280 px, the sheet and the results take the right side: wide enough for the library's results. */
export const SIDE_WIDTH = "[@media(max-width:1279px)_and_(orientation:landscape)]:w-[min(32rem,55%)]";

/** Below 1,280 px: the search at the top, and one sheet along the bottom (down the right side lying down) holding the countries.
 * A chosen country's results open over it. */
export function MapSheet(p: PanelProps) {
	const t = useTranslations("ui");
	const [open, setOpen] = useState(false);
	const still = useReducedMotion();
	return (
		<>
			<div className="fixed inset-x-3 top-[5.75rem] z-10 xl:hidden [@media(max-width:1279px)_and_(orientation:landscape)]:right-auto [@media(max-width:1279px)_and_(orientation:landscape)]:w-[calc(100%-min(32rem,55%)-1.5rem)]">
				<div className={twMerge(PANEL, "relative")}><div className="rounded-2xl bg-[#f2f3f6] p-2 dark:bg-black/10"><Search props={p.props} /></div></div>
			</div>
			<motion.div layout={!still} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className={twMerge(PANEL, SHEET, SIDE_WIDTH, open ? "h-[50dvh]" : "h-14")}>
				<SheetBar name={t("countries")} open={open} onFold={() => setOpen(!open)} />
				<div className={twMerge("min-h-0 flex-1 flex-col", open ? "flex" : "hidden [@media(max-width:1279px)_and_(orientation:landscape)]:flex")}>
					<MapIntro titled={false} countries={p.rows.length} measure={p.measure} onMeasure={p.onMeasure} />
					<CountryList rows={p.rows} chosen={p.props.queryParams.country} stale={Boolean(p.props.isFacetsFetching)} measure={p.measure} tint={p.tint} hovered={p.hovered} onHover={p.onHover} onSelect={p.onSelect} heading={false} />
				</div>
			</motion.div>
		</>
	);
}
