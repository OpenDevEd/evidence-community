"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useFormatter } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";
import { SearchBar } from "@/components/features/SearchBar";
import { Tab, Tabs } from "@/components/nextui/Tabs";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { CountryFlag } from "@/components/statistics/CountryFlag";
import { COUNTRIES, COUNTRY_PARAMS } from "@/constants/misc";
import POPULATION from "@/constants/population.json";
import type { useItemsList } from "@/hooks/useItemsList";
import { twMerge } from "@/lib/tw-merge";
import { RAISED_INPUT } from "./evidence/filter";
import { FITTED_ROWS, fittedBox, muted, PANEL, Pages, useFittedPages } from "./evidence/lists";
import { SHEET, SheetBar } from "./evidence/phone-sheet";

type Props = ReturnType<typeof useItemsList>;

/** What a country's colour and place in the list show: its records for each million people living there, or its records. */
const MEASURES = ["people", "records"] as const;
export type Measure = (typeof MEASURES)[number];

/** The measure, in the address as `?count=records`; records per million people unless it says otherwise. */
export function useMeasure() {
	return useQueryState("count", parseAsStringLiteral(MEASURES).withDefault("people"));
}

const PEOPLE = POPULATION as Record<string, number>;

/** A country in the list: its records, and the value it is ranked and coloured by, none where its population is not known. */
export type CountryRow = { code: string; name: string; count: number; value: number | null };

/** Records for each million people, from the World Bank's 2025 population (SP.POP.TOTL). */
export const perMillion = (code: string, count: number) => (PEOPLE[code] ? (count / PEOPLE[code]) * 1e6 : null);

/** Only countries the region filter knows can be chosen, so only they are listed: largest first, those without a value last. */
export function countryRows(facet: Record<string, number>, measure: Measure): CountryRow[] {
	return Object.entries(facet)
		.flatMap(([code, count]) => (COUNTRY_PARAMS[code] && count ? [{ code, name: COUNTRIES[code] ?? code, count: Number(count), value: measure === "people" ? perMillion(code, Number(count)) : Number(count) }] : []))
		.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

/** A value as the list and the tooltip show it: whole records, or a rate to three figures. */
export function useValueFormat() {
	const format = useFormatter();
	return {
		rate: (value: number) => format.number(value, value >= 100 ? { maximumFractionDigits: 0 } : { maximumSignificantDigits: 3 }),
		count: (value: number) => format.number(value),
	};
}

const UNIT: Record<Measure, string> = { people: "per million people", records: "records" };

/** The page's head, in the panel's darkest grey: what it is, how many countries, and what their colours count. */
function MapIntro({ countries, measure, onMeasure, titled = true }: { countries: number; measure: Measure; onMeasure: (next: Measure) => void; titled?: boolean }) {
	return (
		<div className={twMerge("px-3 pb-3 pt-3", titled && "border-b border-black/[0.06] bg-[#e8eaef] dark:border-white/[0.08] dark:bg-black/25")}>
			{titled && <h1 className="mb-0.5 px-1 font-heading text-lg font-semibold leading-tight tracking-tight">Research by country</h1>}
			{titled && <p className={twMerge("px-1 text-xs", muted)}><span className="font-semibold tabular-nums text-foreground dark:text-white">{countries}</span> countries</p>}
			<Tabs aria-label="Colour countries by" selectedKey={measure} onSelectionChange={(key) => onMeasure(key as Measure)} classNames={{ base: "mt-2.5", tabList: "w-full md:w-full", tab: "flex-1 md:flex-1" }}>
				<Tab key="people" title="Per million people" />
				<Tab key="records" title="Total records" />
			</Tabs>
		</div>
	);
}

/** A country row's height: name over its bar. */
const COUNTRY_ROW = 48;

/**
 * The library's countries by the chosen measure, a page at a time. The list is the map's key: each bar has its country's colour.
 * Pointing at a row lifts its country on the map; choosing one shows its records, and a chosen one stays marked.
 */
function CountryList({ rows, chosen, measure, tint, hovered, onHover, onSelect, heading = true }: { rows: CountryRow[]; chosen: string[]; measure: Measure; tint: (value: number | null) => string; hovered: string | null; onHover: (code: string | null) => void; onSelect: (code: string) => void; heading?: boolean }) {
	const { boxRef, listRef, ...fit } = useFittedPages(rows, COUNTRY_ROW);
	const { rate, count } = useValueFormat();
	// The bars are each country's true share of the top one; only the map's colour is capped.
	const top = rows[0]?.value || 1;
	return (
		<section ref={boxRef} aria-labelledby={heading ? "map-countries" : undefined} aria-label={heading ? undefined : "Countries"} className={fittedBox(fit.ready, fit.fits)}>
			{heading && (
				<h2 id="map-countries" className="flex items-baseline justify-between px-5 pb-2 pt-1 text-sm font-semibold">
					Countries
					<span className={twMerge("text-xs font-medium", muted)}>{UNIT[measure]}</span>
				</h2>
			)}
			<ol ref={listRef} style={fit.rowStyle} className={twMerge("px-2", FITTED_ROWS)} onPointerLeave={() => onHover(null)}>
				{fit.shown.map((row, k) => {
					const selected = chosen.includes(COUNTRY_PARAMS[row.code]);
					return (
						<li key={row.code}>
							<button type="button" aria-pressed={selected} onPointerEnter={() => onHover(row.code)} onFocus={() => onHover(row.code)} onBlur={() => onHover(null)} onClick={() => onSelect(row.code)} className={twMerge("flex h-12 w-full min-w-0 items-center gap-3 rounded-xl px-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent", hovered === row.code && "bg-black/[0.04] dark:bg-white/[0.06]", selected && "bg-accent/10 dark:bg-accent/15")}>
								<span className={twMerge("w-5 shrink-0 text-right text-xs tabular-nums", muted)}>{(fit.page - 1) * fit.per + k + 1}</span>
								<CountryFlag countryCode={row.code} className="h-3.5 w-5 shrink-0 rounded-[3px]" />
								<span className="flex min-w-0 flex-1 flex-col gap-1.5">
									<TruncatedText text={row.name} className={twMerge("text-sm", selected ? "font-semibold" : "font-medium")} />
									<span aria-hidden className="block h-1 rounded-full bg-black/5 dark:bg-white/10">
										<span className="block h-full rounded-full" style={{ width: `${row.value === null ? 0 : Math.max(2, (100 * row.value) / top)}%`, background: tint(row.value) }} />
									</span>
								</span>
								<span className={twMerge("min-w-[4.5rem] shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums", row.value === null && twMerge("text-xs font-medium", muted))}>
									{row.value === null ? "No census" : measure === "people" ? rate(row.value) : count(row.value)}
								</span>
							</button>
						</li>
					);
				})}
			</ol>
			<Pages total={fit.pages} page={fit.page} onChange={fit.setPage} label="Pages of countries" />
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
				<CountryList rows={p.rows} chosen={p.props.queryParams.country} measure={p.measure} tint={p.tint} hovered={p.hovered} onHover={p.onHover} onSelect={p.onSelect} />
			</div>
		</div>
	);
}

/** Lying on its side below 1,280 px, the sheet and the results take the right side: wide enough for the library's results. */
export const SIDE_WIDTH = "[@media(max-width:1279px)_and_(orientation:landscape)]:w-[min(32rem,55%)]";

/** Below 1,280 px: the search at the top, and one sheet along the bottom (down the right side lying down) holding the countries.
 * A chosen country's results open over it. */
export function MapSheet(p: PanelProps) {
	const [open, setOpen] = useState(false);
	const still = useReducedMotion();
	return (
		<>
			<div className="fixed inset-x-3 top-[5.75rem] z-10 xl:hidden [@media(max-width:1279px)_and_(orientation:landscape)]:right-auto [@media(max-width:1279px)_and_(orientation:landscape)]:w-[calc(100%-min(32rem,55%)-1.5rem)]">
				<div className={twMerge(PANEL, "relative")}><div className="rounded-2xl bg-[#f2f3f6] p-2 dark:bg-black/10"><Search props={p.props} /></div></div>
			</div>
			<motion.div layout={!still} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className={twMerge(PANEL, SHEET, SIDE_WIDTH, open ? "h-[50dvh]" : "h-14")}>
				<SheetBar name="Countries" open={open} onFold={() => setOpen(!open)} />
				<div className={twMerge("min-h-0 flex-1 flex-col", open ? "flex" : "hidden [@media(max-width:1279px)_and_(orientation:landscape)]:flex")}>
					<MapIntro titled={false} countries={p.rows.length} measure={p.measure} onMeasure={p.onMeasure} />
					<CountryList rows={p.rows} chosen={p.props.queryParams.country} measure={p.measure} tint={p.tint} hovered={p.hovered} onHover={p.onHover} onSelect={p.onSelect} heading={false} />
				</div>
			</motion.div>
		</>
	);
}
