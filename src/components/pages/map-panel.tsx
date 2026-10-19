"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { motion, useReducedMotion } from "framer-motion";
import { useFormatter } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";
import { SearchBar } from "@/components/features/SearchBar";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Tab, Tabs } from "@/components/nextui/Tabs";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { CountryFlag } from "@/components/statistics/CountryFlag";
import { COUNTRIES, COUNTRY_PARAMS } from "@/constants/misc";
import POPULATION from "@/constants/population.json";
import type { useItemsList } from "@/hooks/useItemsList";
import { twMerge } from "@/lib/tw-merge";
import Link from "next/link";
import type { ListItem } from "@/app/api/item/types";
import { RAISED_INPUT } from "./evidence/filter";
import { labelOfRecord } from "./evidence/data";
import { FITTED_ROWS, fittedBox, muted, PANEL, Pages, RowText, useFittedPages } from "./evidence/lists";
import { SlideStack } from "./evidence/panels";
import { BackButton } from "./evidence/paper";
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
 * Pointing at a row lifts its country on the map; choosing one opens its records.
 */
function CountryList({ rows, measure, tint, hovered, onHover, onSelect, heading = true }: { rows: CountryRow[]; measure: Measure; tint: (value: number | null) => string; hovered: string | null; onHover: (code: string | null) => void; onSelect: (code: string) => void; heading?: boolean }) {
	const { boxRef, listRef, ...fit } = useFittedPages(rows, COUNTRY_ROW);
	const { rate, count } = useValueFormat();
	// The bars are each country's true share of the top one; only the map's colour is capped.
	const top = rows[0]?.value || 1;
	return (
		<section ref={boxRef} aria-labelledby={heading ? "map-countries" : undefined} aria-label={heading ? undefined : "Countries"} className={fittedBox(fit.ready)}>
			{heading && (
				<h2 id="map-countries" className="flex items-baseline justify-between px-5 pb-2 pt-1 text-sm font-semibold">
					Countries
					<span className={twMerge("text-xs font-medium", muted)}>{UNIT[measure]}</span>
				</h2>
			)}
			<ol ref={listRef} style={fit.rowStyle} className={twMerge("px-2", FITTED_ROWS)} onPointerLeave={() => onHover(null)}>
				{fit.shown.map((row, k) => (
					<li key={row.code}>
						<button type="button" onPointerEnter={() => onHover(row.code)} onFocus={() => onHover(row.code)} onBlur={() => onHover(null)} onClick={() => onSelect(row.code)} className={twMerge("flex h-12 w-full min-w-0 items-center gap-3 rounded-xl px-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent", hovered === row.code && "bg-black/[0.04] dark:bg-white/[0.06]")}>
							<span className={twMerge("w-5 shrink-0 text-right text-xs tabular-nums", muted)}>{(fit.page - 1) * fit.per + k + 1}</span>
							<CountryFlag countryCode={row.code} className="h-3.5 w-5 shrink-0 rounded-[3px]" />
							<span className="flex min-w-0 flex-1 flex-col gap-1.5">
								<TruncatedText text={row.name} className="text-sm font-medium" />
								<span aria-hidden className="block h-1 rounded-full bg-black/5 dark:bg-white/10">
									<span className="block h-full rounded-full" style={{ width: `${row.value === null ? 0 : Math.max(2, (100 * row.value) / top)}%`, background: tint(row.value) }} />
								</span>
							</span>
							<span className={twMerge("min-w-[4.5rem] shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums", row.value === null && twMerge("text-xs font-medium", muted))}>
								{row.value === null ? "No census" : measure === "people" ? rate(row.value) : count(row.value)}
							</span>
						</button>
					</li>
				))}
			</ol>
			<Pages total={fit.pages} page={fit.page} onChange={fit.setPage} label="Pages of countries" />
		</section>
	);
}

/** A chosen country over its records: its flag and name, both its numbers, and a way to drop it when several are chosen. */
function ChosenCountry({ code, count, several, onRemove }: { code: string; count: number; several: boolean; onRemove: () => void }) {
	const { rate, count: whole } = useValueFormat();
	const value = perMillion(code, count);
	return (
		<li className="flex items-center gap-3 py-1.5">
			<CountryFlag countryCode={code} className="h-5 w-7 shrink-0 rounded" />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-base font-semibold leading-snug">{COUNTRIES[code] ?? code}</span>
				<span className={twMerge("flex gap-3 text-xs", muted)}>
					{value !== null && <span><strong className="font-semibold tabular-nums text-foreground dark:text-white">{rate(value)}</strong> per million people</span>}
					<span><strong className="font-semibold tabular-nums text-foreground dark:text-white">{whole(count)}</strong> records</span>
				</span>
			</span>
			{several && (
				<button type="button" aria-label={`Remove ${COUNTRIES[code] ?? code}`} onClick={onRemove} className="grid size-8 shrink-0 place-items-center rounded-lg outline-none hover:bg-black/[0.05] focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/10">
					<HugeiconsIcon icon={Cancel01Icon} size={14} aria-hidden />
				</button>
			)}
		</li>
	);
}

/** The chosen countries' records, slid over the list with the back arrow to it: a page at a time, each row opening its record. */
function CountryResults({ props, codes, facet, onSelect }: { props: Props; codes: string[]; facet: Record<string, number>; onSelect: (code: string) => void }) {
	const data = props.itemsData;
	const { count } = useValueFormat();
	return (
		<div className="min-h-0 flex-1 overflow-y-auto pb-3">
			<div className="px-5 pt-3"><BackButton to="Countries" onBack={props.handleClearFilters} /></div>
			<ul className="px-5 pb-2 pt-1">
				{codes.map((code) => <ChosenCountry key={code} code={code} count={facet[code] ?? 0} several={codes.length > 1} onRemove={() => onSelect(code)} />)}
			</ul>
			<section aria-labelledby="map-records" className="border-t border-black/[0.06] pt-2 dark:border-white/[0.08]">
				<h2 id="map-records" className="flex items-baseline justify-between px-5 pb-2 pt-1 text-sm font-semibold">
					Records
					<span className={twMerge("text-xs font-medium tabular-nums", muted)}>{data ? count(data.totalItems) : " "}</span>
				</h2>
				<ol inert={props.isItemsFetching} className={twMerge("px-2 transition-opacity", props.isItemsFetching && "opacity-50")}>
					{(data?.items ?? []).map((item: ListItem) => {
						const line = labelOfRecord(item);
						return (
							<li key={item.key}>
								<Link href={`/lib/${item.key}`} className="flex w-full min-w-0 items-start gap-2.5 rounded-xl px-3 py-2 text-left outline-none transition-colors hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/[0.06]">
									<RowText who={line.who} year={line.year} title={line.title} aside={[]} />
								</Link>
							</li>
						);
					})}
				</ol>
				<Pages total={data?.totalPages ?? 0} page={props.queryParams.page || 1} onChange={props.handlePageChange} label="Pages of records" stale={props.isItemsFetching} />
			</section>
		</div>
	);
}

/** The chosen countries' codes, from the region filter's places, in the order chosen. */
function chosenCodes(chosen: string[]) {
	return chosen.flatMap((location) => Object.entries(COUNTRY_PARAMS).filter(([, place]) => place === location).map(([code]) => code));
}

export type PanelProps = { props: Props; rows: CountryRow[]; facet: Record<string, number>; measure: Measure; onMeasure: (next: Measure) => void; tint: (value: number | null) => string; hovered: string | null; onHover: (code: string | null) => void; onSelect: (code: string) => void; smallLayout: boolean };

/** The countries' list, or the chosen countries' records slid over it. */
function MapStack({ titled, ...p }: PanelProps & { titled: boolean }) {
	const codes = chosenCodes(p.props.queryParams.country);
	const list = (
		<>
			{!titled && <MapIntro titled={false} countries={p.rows.length} measure={p.measure} onMeasure={p.onMeasure} />}
			<CountryList rows={p.rows} measure={p.measure} tint={p.tint} hovered={p.hovered} onHover={p.onHover} onSelect={p.onSelect} heading={titled} />
		</>
	);
	return <SlideStack list={list} paneKey={codes.length ? "chosen" : "list"} depth={codes.length ? 1 : 0} label="Chosen countries" pane={codes.length > 0 && <CountryResults props={p.props} codes={codes} facet={p.facet} onSelect={p.onSelect} />} />;
}

/** The search, raised in white on the band's grey. */
function Search({ props }: { props: Props }) {
	return <SearchBar handleSearchChange={props.handleSearchChange} search={props.queryParams.search} classNames={RAISED_INPUT} />;
}

/** From 1,280 px wide, one panel down the left, as on the evidence map: the head, the search band, then the list or the chosen countries' records. */
export function MapPanel(p: PanelProps) {
	return (
		<div className={twMerge("pointer-events-none fixed inset-y-0 left-0 z-10 hidden w-[calc(23rem+1rem)] pb-4 pl-4 pt-[calc(7.5rem-1.5rem)] xl:block", p.smallLayout && "pt-[7.5rem]")}>
			<div className={twMerge(PANEL, "pointer-events-auto flex h-full flex-col overflow-hidden")}>
				<MapIntro countries={p.rows.length} measure={p.measure} onMeasure={p.onMeasure} />
				<div className="relative z-10 border-b border-black/[0.06] bg-[#f2f3f6] p-3 dark:border-white/[0.08] dark:bg-black/10"><Search props={p.props} /></div>
				<MapStack {...p} titled />
			</div>
		</div>
	);
}

/** Whether the phone's sheet is open: folded at first so the globe has the screen, and opened whenever a country is chosen. */
function useSheetOpen(chosen: number) {
	const [open, setOpen] = useState(chosen > 0);
	const [seen, setSeen] = useState(chosen);
	if (chosen !== seen) {
		setSeen(chosen);
		if (chosen > seen) setOpen(true);
	}
	return [open, setOpen] as const;
}

/** Below 1,280 px: the search at the top, and one sheet along the bottom (down the right side lying down) holding what the wide panel does. */
export function MapSheet(p: PanelProps) {
	const codes = chosenCodes(p.props.queryParams.country);
	const [open, setOpen] = useSheetOpen(codes.length);
	const still = useReducedMotion();
	const name = codes.length === 1 ? COUNTRIES[codes[0]] ?? codes[0] : codes.length ? `${codes.length} countries` : "Countries";
	return (
		<>
			<div className="fixed inset-x-3 top-[5.75rem] z-10 xl:hidden [@media(max-width:1279px)_and_(orientation:landscape)]:right-auto [@media(max-width:1279px)_and_(orientation:landscape)]:w-[calc(100%-min(26rem,55%)-1.5rem)]">
				<div className={twMerge(PANEL, "relative")}><div className="rounded-2xl bg-[#f2f3f6] p-2 dark:bg-black/10"><Search props={p.props} /></div></div>
			</div>
			<motion.div layout={!still} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className={twMerge(PANEL, SHEET, open ? "h-[50dvh]" : "h-14")}>
				<SheetBar name={name} open={open} onFold={() => setOpen(!open)} />
				<div className={twMerge("min-h-0 flex-1 flex-col", open ? "flex" : "hidden [@media(max-width:1279px)_and_(orientation:landscape)]:flex")}>
					<MapStack {...p} titled={false} />
				</div>
			</motion.div>
		</>
	);
}
