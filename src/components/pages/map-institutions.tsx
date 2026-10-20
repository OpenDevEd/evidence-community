"use client";

import { memo, useMemo } from "react";
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
import { FITTED_ROWS, fittedBox, muted, Pages, useFittedPages } from "./evidence/lists";
import { TipFigures, useValueFormat } from "./map-panel";

/** An institution on the map: its name as the records spell it, its records under the page's filters, and where it is. */
export type InstitutionPoint = { key: string; name: string; count: number; /** Its records in the whole library, while the map is narrowed. */ total?: number; longitude: number; latitude: number; city: string; country: string };
type Places = Record<string, [number, number, string, string]>;

const ONCE = { keepPreviousData: true, revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false };

/** The institutions' record counts under the page's filters, chosen institutions included, so choosing one shows it and the
 * institutions its records share authors with. Joined with where each one is. */
export function useInstitutionPoints(params: ReturnType<typeof useItemsList>["queryParams"], enabled: boolean, totals?: Record<string, number>) {
	const { data: facets, isValidating } = useSWR<FacetsGetResponse>(enabled ? buildFacetsQuery(params) : null, fetcher, ONCE);
	const { data: places } = useSWR<Places>(enabled ? "/institution-locations" : null, fetcher, ONCE);
	const points = useMemo(() => {
		const counts = (facets?.facetDistribution?.[INSTITUTION_FILTER_FIELD] ?? {}) as Record<string, number>;
		return Object.entries(counts)
			.flatMap(([name, count]): InstitutionPoint[] => {
				const key = institutionNameKey(name);
				const place = places?.[key];
				return place ? [{ key, name, count: Number(count), total: totals && (totals[name] ?? 0), longitude: place[0], latitude: place[1], city: place[2], country: place[3] }] : [];
			})
			.sort((a, b) => b.count - a.count);
	}, [facets, places, totals]);
	return { points, stale: isValidating && Boolean(facets) };
}

/** Institutions in the library's accent, darker than the deepest country so they read over it; a chosen one darker still. */
export const DOT = "color-mix(in oklab, rgb(var(--color-accent-500)), black 38%)";
const DOT_CHOSEN = "color-mix(in oklab, rgb(var(--color-accent-500)), black 62%)";

/** A circle's radius on screen at the map's first zoom: its area follows the records. It grows at half the map's rate as it zooms in,
 * so a crowded city opens up. */
const radiusOf = (count: number) => 1.5 + 1.1 * Math.sqrt(count);

export type DotEvents = { onShow: (point: InstitutionPoint) => void; onHide: () => void; onSelect: (point: InstitutionPoint) => void };

/** A circle's place and size: its area follows the records, and it grows at half the map's rate (`--map-k`). */
const circleStyle = (point: InstitutionPoint, stroke: number) =>
	({ r: `calc(${radiusOf(point.count)}px / sqrt(var(--map-k)))`, strokeWidth: `calc(${stroke}px / var(--map-k))` }) as React.CSSProperties;

/** The institutions as circles, largest first so the small ones stay on top and can be pointed at. Drawn again only when the
 * institutions or the projection change: pointing at one marks it in `InstitutionMarks` instead. */
export const InstitutionDots = memo(function InstitutionDots({ points, projection, events }: { points: InstitutionPoint[]; projection: GeoProjection; events: DotEvents }) {
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
export function InstitutionMarks({ points, projection, chosen, hovered }: { points: InstitutionPoint[]; projection: GeoProjection; chosen: string[]; hovered: string | null }) {
	const marked = points.filter((point) => chosen.includes(point.name) || point.key === hovered);
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
export function InstitutionTip({ point }: { point: InstitutionPoint }) {
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

/** The institutions by their records, a page at a time; pointing at one lifts its circle, choosing one shows its records. */
export function InstitutionList({ points, chosen, stale, hovered, onHover, onSelect, heading = true }: { points: InstitutionPoint[]; chosen: string[]; stale: boolean; hovered: string | null; onHover: (key: string | null) => void; onSelect: (point: InstitutionPoint) => void; heading?: boolean }) {
	const { boxRef, listRef, ...fit } = useFittedPages(points, ROW);
	const t = useTranslations("ui");
	return (
		<section ref={boxRef} aria-label={t("institutions")} className={fittedBox(fit.ready, fit.fits)}>
			{heading && (
				<h2 className="flex items-baseline justify-between px-5 pb-2 pt-1 text-sm font-semibold">
					{t("institutions")}
					<span className={twMerge("text-xs font-medium", muted)}>{t("resources")}</span>
				</h2>
			)}
			<ol ref={listRef} inert={stale} style={fit.rowStyle} className={twMerge("px-2 transition-opacity", FITTED_ROWS, stale && "opacity-50")} onPointerLeave={() => onHover(null)}>
				{fit.shown.map((point, k) => (
					<li key={point.key}>
						<InstitutionRow point={point} rank={(fit.page - 1) * fit.per + k + 1} top={points[0]?.count || 1} selected={chosen.includes(point.name)} lifted={hovered === point.key} onHover={onHover} onSelect={onSelect} />
					</li>
				))}
			</ol>
			{!points.length && <p className={twMerge("px-5 text-sm", muted)}>{t("noDataAvailable")}</p>}
			<Pages total={fit.pages} page={fit.page} onChange={fit.setPage} label={t("institutions")} stale={stale} />
		</section>
	);
}
