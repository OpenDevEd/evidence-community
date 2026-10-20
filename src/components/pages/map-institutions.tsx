"use client";

import { memo, useMemo, type ReactNode } from "react";
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
import { FITTED_ROWS, fittedBox, muted, PANEL, Pages, useFittedPages } from "./evidence/lists";
import { useValueFormat } from "./map-panel";

/** An institution on the map: its name as the records spell it, its records under the page's filters, and where it is. */
export type InstitutionPoint = { key: string; name: string; count: number; longitude: number; latitude: number; city: string; country: string };
type Places = Record<string, [number, number, string, string]>;

const ONCE = { keepPreviousData: true, revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false };

/** The institutions' record counts under the page's filters, every chosen institution kept, joined with where each one is. */
export function useInstitutionPoints(params: ReturnType<typeof useItemsList>["queryParams"], enabled: boolean) {
	const { data: facets, isValidating } = useSWR<FacetsGetResponse>(enabled ? buildFacetsQuery({ ...params, institution: [] }) : null, fetcher, ONCE);
	const { data: places } = useSWR<Places>(enabled ? "/institution-locations" : null, fetcher, ONCE);
	const points = useMemo(() => {
		const counts = (facets?.facetDistribution?.[INSTITUTION_FILTER_FIELD] ?? {}) as Record<string, number>;
		return Object.entries(counts)
			.flatMap(([name, count]): InstitutionPoint[] => {
				const key = institutionNameKey(name);
				const place = places?.[key];
				return place ? [{ key, name, count: Number(count), longitude: place[0], latitude: place[1], city: place[2], country: place[3] }] : [];
			})
			.sort((a, b) => b.count - a.count);
	}, [facets, places]);
	return { points, stale: isValidating && Boolean(facets) };
}

/** The colours of the institutions' map: countries in Björn's orange steps by their records, institutions in purple. */
const STEPS: [number, string][] = [[1000, "#993404"], [200, "#d95f0e"], [50, "#fe9929"], [10, "#fec44f"], [1, "#fee391"]];
export const DOT = "#8e3b8e";
const DOT_CHOSEN = "#5a1f5a";

/** A country's colour by its records: the first step it reaches, the land's own colour without any. */
export const stepTint = (count: number) => STEPS.find(([least]) => count >= least)?.[1] ?? "var(--map-land)";

/** A circle's radius on screen at the map's first zoom: its area follows the records. It grows at half the map's rate as it zooms in,
 * so a crowded city opens up. */
const radiusOf = (count: number) => 1.5 + 1.1 * Math.sqrt(count);

type DotsProps = {
	points: InstitutionPoint[];
	projection: GeoProjection;
	chosen: string[];
	hovered: string | null;
	onShow: (point: InstitutionPoint) => void;
	onHide: () => void;
	onSelect: (point: InstitutionPoint) => void;
};

/** The institutions as circles, largest first so the small ones stay on top and can be pointed at. */
export const InstitutionDots = memo(function InstitutionDots({ points, projection, chosen, hovered, onShow, onHide, onSelect }: DotsProps) {
	return (
		<g>
			{points.map((point) => {
				const at = projection([point.longitude, point.latitude]);
				if (!at) return null;
				const lifted = chosen.includes(point.name) || hovered === point.key;
				return (
					<circle
						key={point.key}
						cx={at[0]}
						cy={at[1]}
						aria-hidden
						onMouseEnter={() => onShow(point)}
						onMouseLeave={onHide}
						onClick={() => onSelect(point)}
						className="cursor-pointer"
						fill={lifted ? DOT_CHOSEN : DOT}
						fillOpacity={0.8}
						stroke="white"
						style={{ r: `calc(${radiusOf(point.count)}px / sqrt(var(--map-k)))`, strokeWidth: `calc(${lifted ? 2 : 0.8}px / var(--map-k))` } as React.CSSProperties}
					/>
				);
			})}
		</g>
	);
});

/** The institution pointed at: its flag and name, where it is, and its records. */
export function InstitutionTip({ point }: { point: InstitutionPoint }) {
	const t = useTranslations("ui");
	const number = (value: ReactNode) => <strong className="font-semibold tabular-nums text-black dark:text-white">{value}</strong>;
	return (
		<div className="flex max-w-72 flex-col gap-0.5 px-1 py-0.5">
			<div className="flex items-center gap-2 text-sm font-semibold">
				<CountryFlag countryCode={point.country} className="h-3 w-[1.125rem] shrink-0 rounded-[2px]" />
				<span className="min-w-0">{point.name}</span>
			</div>
			<div className="flex gap-3 text-xs text-black/60 dark:text-white/60">
				<span>{[point.city, COUNTRIES[point.country]].filter(Boolean).join(", ")}</span>
				<span>{t.rich("resourcesCount", { count: point.count, number })}</span>
			</div>
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

/** What the colours and circles mean, beside the zoom buttons. */
export function InstitutionLegend() {
	const t = useTranslations("ui");
	return (
		<div className={twMerge(PANEL, "fixed bottom-4 left-[calc(24rem+3.75rem)] z-10 hidden px-3 py-2.5 text-xs leading-5 xl:block")}>
			<p className="mb-1 font-semibold">{t("mapResourcesPerCountry")}</p>
			{STEPS.map(([least, colour], index) => (
				<p key={least} className="flex items-center gap-2">
					<span className="h-2.5 w-3 rounded-[2px] border border-black/20" style={{ background: colour }} />
					{index ? `${least.toLocaleString("en-GB")}–${(STEPS[index - 1][0] - 1).toLocaleString("en-GB")}` : t("mapOrMore", { count: least })}
				</p>
			))}
			<p className="mt-1 flex items-center gap-2">
				<span className="size-2.5 rounded-full" style={{ background: DOT }} />
				{t("institutions")}
			</p>
		</div>
	);
}
