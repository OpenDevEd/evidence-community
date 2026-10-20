"use client";

import { memo, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import type { GeoProjection } from "d3-geo";
import type { FacetsGetResponse } from "@/app/api/facets/types";
import { INSTITUTION_FILTER_FIELD, institutionNameKey } from "@/config/library-config/institutions";
import { COUNTRIES } from "@/constants/misc";
import { CountryFlag } from "@/components/statistics/CountryFlag";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { buildFacetsQuery, fetcher } from "@/lib/utils";
import { twMerge } from "@/lib/tw-merge";
import type { useItemsList } from "@/hooks/useItemsList";

type Props = ReturnType<typeof useItemsList>;
import { FITTED_ROWS, fittedBox, muted, Pages, useFittedPages } from "./evidence/lists";
import { TipFigures, useValueFormat } from "./map-figures";
import { totalIn } from "./map-measure";

/** An institution on the map: its name as the records spell it, its records under the page's filters, and where it is. */
export type InstitutionPoint = { key: string; name: string; /** Every spelling the records use, the most used first. */ names: string[]; count: number; /** Its records in the whole library, while the map is narrowed. */ total?: number; longitude: number; latitude: number; city: string; country: string };
type Places = Record<string, [number, number, string, string]>;

const ONCE = { keepPreviousData: true, revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false };

/** The institutions the facets count, by name.
 * ponytail: the search index gives at most 10,000 values a facet (`maxValuesPerFacet`), so a library with more institutions than
 * that leaves its least-cited ones off the unfiltered map; a narrower search shows them. Raise the index's limit if that matters:
 * every facets request carries this facet. */
const institutionCounts = (facets: FacetsGetResponse | undefined) => (facets?.facetDistribution?.[INSTITUTION_FILTER_FIELD] ?? {}) as Record<string, number>;

type Spellings = { key: string; names: string[]; count: number; place: Places[string] };

/** Adds one spelling the facets count to its institution, where the institution's place is known. Records may spell one name
 * in more than one way (case, accents); it is one circle, its spellings' records added up. */
function addSpelling(groups: Map<string, Spellings>, name: string, count: number, places: Places | undefined) {
	const key = institutionNameKey(name);
	const place = places?.[key];
	if (!place) return;
	const group = groups.get(key) ?? { key, names: [], count: 0, place };
	group.names.push(name);
	group.count += count;
	groups.set(key, group);
}

/** The whole library's records by folded institution name, every spelling the library uses added up, also those the page's
 * filters leave out. */
function foldedTotals(totals: Record<string, number> | undefined) {
	if (!totals) return undefined;
	const folded: Record<string, number> = {};
	for (const [name, count] of Object.entries(totals)) folded[institutionNameKey(name)] = (folded[institutionNameKey(name)] ?? 0) + count;
	return folded;
}

/** The placed institutions, most records first. The facets list the most used spelling first, so it names the circle. */
export function pointsOf(facets: FacetsGetResponse | undefined, places: Places | undefined, totals: Record<string, number> | undefined): InstitutionPoint[] {
	const groups = new Map<string, Spellings>();
	for (const [name, count] of Object.entries(institutionCounts(facets))) addSpelling(groups, name, Number(count), places);
	const library = foldedTotals(totals);
	return [...groups.values()]
		.map(({ key, names, count, place }) => ({ key, name: names[0], names, count, total: totalIn(library, key), longitude: place[0], latitude: place[1], city: place[2], country: place[3] }))
		.sort((a, b) => b.count - a.count);
}

/** The spelling choosing an institution's circle toggles: the one chosen, else the most used. One, as the search requires every
 * institution chosen: two spellings would ask for records naming both. */
const chosenSpelling = (point: InstitutionPoint, chosen: string[]) => point.names.find((name) => chosen.includes(name)) ?? point.name;

/** Whether any spelling of the institution is chosen. */
const isChosen = (point: InstitutionPoint, chosen: string[]) => point.names.some((name) => chosen.includes(name));

/** The institutions' record counts under the page's filters, chosen institutions included, so choosing one shows it and the
 * institutions its records share authors with. Joined with where each one is. */
function useInstitutionPoints(params: Props["queryParams"], enabled: boolean, totals?: Record<string, number>) {
	const keys = enabled ? [buildFacetsQuery(params), "/institution-locations"] : [null, null];
	const { data: facets, isValidating } = useSWR<FacetsGetResponse>(keys[0], fetcher, ONCE);
	const { data: places } = useSWR<Places>(keys[1], fetcher, ONCE);
	const points = useMemo(() => pointsOf(facets, places, totals), [facets, places, totals]);
	// Until both the counts and the places have arrived there is nothing to show yet, not an empty list.
	const ready = Boolean(facets) && Boolean(places);
	return { points, ready, stale: ready && isValidating };
}

/** Institutions in the library's accent, darker than the deepest country so they read over it; a chosen one darker still. */
export const DOT = "color-mix(in oklab, rgb(var(--color-accent-500)), black 38%)";
const DOT_CHOSEN = "color-mix(in oklab, rgb(var(--color-accent-500)), black 62%)";

/** A circle's radius on screen at the map's first zoom: its area follows the records. It grows at half the map's rate as it zooms in,
 * so a crowded city opens up. */
const radiusOf = (count: number) => 1.5 + 1.1 * Math.sqrt(count);

type DotEvents = { onShow: (point: InstitutionPoint) => void; onHide: () => void; onSelect: (point: InstitutionPoint) => void };

/** A circle's place and size: its area follows the records, and it grows at half the map's rate (`--map-k`). */
const circleStyle = (point: InstitutionPoint, stroke: number) =>
	({ r: `calc(${radiusOf(point.count)}px / sqrt(var(--map-k)))`, strokeWidth: `calc(${stroke}px / var(--map-k))` }) as React.CSSProperties;

/** The institutions as circles, largest first so the small ones stay on top and can be pointed at. Drawn again only when the
 * institutions or the projection change: pointing at one marks it in `InstitutionMarks` instead. */
const InstitutionDots = memo(function InstitutionDots({ points, projection, events }: { points: InstitutionPoint[]; projection: GeoProjection; events: DotEvents }) {
	return (
		<g>
			{points.map((point) => {
				const at = projection([point.longitude, point.latitude]);
				if (!at) return null;
				return (
					<circle
						key={point.key}
						cx={at[0]}
						cy={at[1]}
						aria-hidden
						onMouseEnter={() => events.onShow(point)}
						onMouseLeave={events.onHide}
						onClick={() => events.onSelect(point)}
						className="cursor-pointer"
						fill={DOT}
						fillOpacity={0.8}
						stroke="white"
						style={circleStyle(point, 0.8)}
					/>
				);
			})}
		</g>
	);
});

/** The chosen institutions and the one pointed at, darker and outlined, over the rest. */
function InstitutionMarks({ points, projection, chosen, hovered }: { points: InstitutionPoint[]; projection: GeoProjection; chosen: string[]; hovered: string | null }) {
	const marked = points.filter((point) => isChosen(point, chosen) || point.key === hovered);
	return (
		<g aria-hidden className="pointer-events-none">
			{marked.map((point) => {
				const at = projection([point.longitude, point.latitude]);
				return at && <circle key={point.key} cx={at[0]} cy={at[1]} fill={DOT_CHOSEN} stroke="white" style={circleStyle(point, 2)} />;
			})}
		</g>
	);
}

/** The institution pointed at: its flag and name, where it is, and its figures in the whole library and, while the map is narrowed, now. */
function InstitutionTip({ point }: { point: InstitutionPoint }) {
	return (
		<div className="flex max-w-72 flex-col gap-0.5 px-1 py-0.5">
			<div className="flex items-center gap-2 text-sm font-semibold">
				<CountryFlag countryCode={point.country} className="h-3 w-[1.125rem] shrink-0 rounded-[2px]" />
				<span className="min-w-0">{point.name}</span>
			</div>
			<div className="text-xs text-black/60 dark:text-white/60">{[point.city, COUNTRIES[point.country]].filter(Boolean).join(", ")}</div>
			<TipFigures total={point.total} count={point.count} />
		</div>
	);
}

const ROW = 48;

/** One institution: its rank, flag and name over its bar, and its records. */
function InstitutionRow({ point, rank, top, selected, lifted, onHover, onSelect }: { point: InstitutionPoint; rank: number; top: number; selected: boolean; lifted: boolean; onHover: (key: string | null) => void; onSelect: (point: InstitutionPoint) => void }) {
	const { count } = useValueFormat();
	return (
		<button type="button" aria-pressed={selected} onPointerEnter={() => onHover(point.key)} onFocus={() => onHover(point.key)} onBlur={() => onHover(null)} onClick={() => onSelect(point)} className={twMerge("flex h-12 w-full min-w-0 items-center gap-3 rounded-xl px-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent", lifted && "bg-black/[0.04] dark:bg-white/[0.06]", selected && "bg-accent/10 font-semibold dark:bg-accent/15")}>
			<span className={twMerge("w-5 shrink-0 text-right text-xs font-normal tabular-nums", muted)}>{rank}</span>
			<CountryFlag countryCode={point.country} className="h-3.5 w-5 shrink-0 rounded-[3px]" />
			<span className="flex min-w-0 flex-1 flex-col gap-1.5">
				<TruncatedText text={point.name} className={twMerge("text-sm", !selected && "font-medium")} />
				<span aria-hidden className="block h-1 rounded-full bg-black/5 dark:bg-white/10">
					<span className="block h-full rounded-full" style={{ width: `${Math.max(2, (100 * point.count) / top)}%`, background: DOT }} />
				</span>
			</span>
			<span className="min-w-[3.5rem] shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums">{count(point.count)}</span>
		</button>
	);
}

/** The list's heading: what it is, and what its numbers count. */
function InstitutionsHeading() {
	const t = useTranslations("ui");
	return (
		<h2 className="flex items-baseline justify-between px-5 pb-2 pt-1 text-sm font-semibold">
			{t("institutions")}
			<span className={twMerge("text-xs font-medium", muted)}>{t("resources")}</span>
		</h2>
	);
}

/** Under the rows, once the institutions have arrived: that there are none, or the page numbers. */
function InstitutionsFoot({ ready, empty, pages, page, onPage, stale }: { ready: boolean; empty: boolean; pages: number; page: number; onPage: (page: number) => void; stale: boolean }) {
	const t = useTranslations("ui");
	if (!ready) return null;
	if (empty) return <p className={twMerge("px-5 text-sm", muted)}>{t("noDataAvailable")}</p>;
	return <Pages total={pages} page={page} onChange={onPage} label={t("institutions")} stale={stale} />;
}

/** The busiest institution's records, which the bars are shares of. */
const topCount = (points: InstitutionPoint[]) => points[0]?.count || 1;

/** The institutions by their records, a page at a time; pointing at one lifts its circle, choosing one shows its records. */
export function InstitutionList({ points, ready, chosen, stale, hovered, onHover, onSelect, heading = true, resetOn }: { /** The search and filters the rows come from: a new one starts at page one. */ resetOn: string; points: InstitutionPoint[]; ready: boolean; chosen: string[]; stale: boolean; hovered: string | null; onHover: (key: string | null) => void; onSelect: (point: InstitutionPoint) => void; heading?: boolean }) {
	const { boxRef, listRef, ...fit } = useFittedPages(points, ROW, resetOn);
	const t = useTranslations("ui");
	return (
		<section ref={boxRef} aria-label={t("institutions")} className={fittedBox(fit.ready, fit.fits)}>
			{heading && <InstitutionsHeading />}
			<ol ref={listRef} inert={stale} style={fit.rowStyle} className={twMerge("px-2 transition-opacity", FITTED_ROWS, stale && "opacity-50")} onPointerLeave={() => onHover(null)}>
				{fit.shown.map((point, k) => (
					<li key={point.key}>
						<InstitutionRow point={point} rank={(fit.page - 1) * fit.per + k + 1} top={topCount(points)} selected={isChosen(point, chosen)} lifted={hovered === point.key} onHover={onHover} onSelect={onSelect} />
					</li>
				))}
			</ol>
			<InstitutionsFoot ready={ready} empty={!points.length} pages={fit.pages} page={fit.page} onPage={fit.setPage} stale={stale} />
		</section>
	);
}

/** Nothing over the countries, outside the institutions' mode. */
const NO_OVERLAY = () => null;

type LayerOptions = {
	props: Props;
	enabled: boolean;
	/** The institutions' records in the whole library, while the map is narrowed. */
	totals: Record<string, number> | undefined;
	setTooltipContent: (content: ReactNode) => void;
	setTooltipAnchor: (anchor: null) => void;
};

/**
 * The institutions' mode: the panel's list and the circles over the countries, which share what is pointed at and chosen.
 * Pointing at a circle shows its tooltip; choosing one filters the results by it. Neither in the other modes.
 */
export function useInstitutionLayer({ props, enabled, totals, setTooltipContent, setTooltipAnchor }: LayerOptions) {
	const institutions = useInstitutionPoints(props.queryParams, enabled, totals);
	const [hovered, setHovered] = useState<string | null>(null);
	const { handleInstitutionSelect } = props;
	const chosen = props.queryParams.institution;
	// Stable until an institution is chosen, so pointing at a circle doesn't draw thousands again.
	const events = useMemo<DotEvents>(() => ({
		onShow: (point) => {
			setTooltipAnchor(null);
			setTooltipContent(<InstitutionTip point={point} />);
			setHovered(point.key);
		},
		onHide: () => {
			setTooltipContent(null);
			setHovered(null);
		},
		onSelect: (point) => {
			setTooltipContent(null);
			setHovered(null);
			handleInstitutionSelect(chosenSpelling(point, chosen));
		},
	}), [setTooltipAnchor, setTooltipContent, handleInstitutionSelect, chosen]);
	if (!enabled) return { overlay: NO_OVERLAY };
	return {
		panel: { ...institutions, chosen, hovered, onHover: setHovered, onSelect: events.onSelect },
		overlay: (projection: GeoProjection) => (
			<>
				<InstitutionDots points={institutions.points} projection={projection} events={events} />
				<InstitutionMarks points={institutions.points} projection={projection} chosen={chosen} hovered={hovered} />
			</>
		),
	};
}
