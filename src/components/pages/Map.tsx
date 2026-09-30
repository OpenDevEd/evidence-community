"use client";

import {
	ComposableMap,
	Geographies,
	Geography,
	Graticule,
	Sphere,
	ZoomableGroup,
} from "react-simple-maps";
import { geoEqualEarth, geoPath } from "d3-geo";
import { ReactNode, useEffect, useMemo, useState, useRef, memo } from "react";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/components/nextui/Tooltip";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { CountryFlag } from "@/components/statistics/CountryFlag";
import { useMouse, useWindowSize } from "@uidotdev/usehooks";
import { useItemsList } from "@/hooks/useItemsList";
import { A3ToA2, COUNTRIES, COUNTRY_PARAMS } from "@/constants/misc";
import ItemsList from "../features/items/ItemsList";
import { AnimatePresence, motion } from "framer-motion";
import { Card } from "@/components/nextui/Card";
import { SearchBar } from "@/components/features/SearchBar";
import { SORT_OPTIONS } from "@/constants/items";
import { twMerge } from "@/lib/tw-merge";
import useBreakpoint from "@/hooks/useBreakpoint";
import { BREAKPOINTS } from "@/../design-tokens";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

// URL to the world map GeoJSON data
const geoUrl = "/features.json";

function MouseTooltip({
	content,
	zoomData,
	anchor,
}: {
	content: ReactNode | null;
	zoomData: any;
	anchor: { x: number; y: number } | null;
}) {
	const [mouse] = useMouse();
	const dragging = zoomData?.dragging;
	const isDesktop = useBreakpoint("md");

	if (!isDesktop && !anchor) {
		return null;
	}

	const top = anchor?.y ?? (dragging ? dragging.y : mouse.y);
	const left = anchor?.x ?? (dragging ? dragging.x : mouse.x);
	return (
		<Tooltip
			color="default"
			isOpen={!!content}
			content={content}
			className="select-none"
			// React Aria re-positions only when its inputs change, not when the
			// trigger moves. A sub-pixel cross offset tied to the pointer makes
			// the tooltip follow it.
			// ponytail: a hash of the position; two points can share one, which
			// leaves the tooltip a move behind until the next change.
			crossOffset={((top * 7919 + left) % 1000) / 1e6}
		>
			<div
				style={{
					position: "fixed",
					top,
					left,
					pointerEvents: "none",
				}}
				className="size-0"
			></div>
		</Tooltip>
	);
}

function ItemView({ props }: { props: ReturnType<typeof useItemsList> }) {
	const isCountrySelected = props.queryParams.country.length > 0;
	const { theme } = useLibraryConfig();
	const t = useTranslations("ui");
	const isDesktop = useBreakpoint("md");
	const panelRef = useRef<HTMLDivElement>(null);

	const previousFocus = useRef<HTMLElement | SVGElement | null>(null);
	useEffect(() => {
		const panel = panelRef.current;
		if (!isCountrySelected) {
			if (panel?.contains(document.activeElement)) {
				previousFocus.current?.focus({ preventScroll: true });
			}
			previousFocus.current = null;
			return;
		}
		// The responsive hook initially returns its server value during hydration.
		const isDesktopNow = window.matchMedia(`(min-width: ${BREAKPOINTS.md})`).matches;
		if (isDesktopNow || panel?.contains(document.activeElement)) return;
		const activeElement = document.activeElement;
		if (
			activeElement instanceof HTMLElement ||
			activeElement instanceof SVGElement
		) {
			previousFocus.current = activeElement;
		}
		panel?.focus({ preventScroll: true });
	}, [isCountrySelected, isDesktop]);

	return (
		<AnimatePresence>
			{isCountrySelected && (
				<motion.div
					ref={panelRef}
					role="region"
					aria-label={t("resultsLabel")}
					tabIndex={-1}
					className={twMerge(
						"fixed right-0 inset-y-0 top-36 z-20 outline-none w-full md:w-auto md:top-0 md:pt-[calc(7.5rem-1.5rem)] md:pr-4 md:pb-4",
						theme.layout === "small" && "md:pt-[calc(7.5rem)]",
					)}
					initial={{ opacity: 0, x: 100 }}
					animate={{ opacity: 1, x: 0 }}
					exit={{ opacity: 0, x: 100 }}
					transition={{ duration: 0.3 }}
				>
					<div className="w-full md:w-[32rem] h-full rounded-2xl overflow-y-scroll overflow-x-hidden no-scrollbar">
						<Card color="card" className="p-4 min-h-full">
							<ItemsList props={props} contentId="map-results" />
						</Card>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

const MemoizedItemView = memo(ItemView, (prevProps, nextProps) => {
	return prevProps.props === nextProps.props;
});

type CountryRow = { code: string; name: string; count: number };
type Feature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { name: string }> & { id: string; rsmKey: string };
/** A country on the map: `location` is its place in the region filter, when it has one. */
type Country = { code?: string; location?: string; name: string; count: number; selected: boolean };
type Anchor = { x: number; y: number } | null;
/** Each country's place on the globe, by code. */
type Places = Record<string, [number, number]>;
/** The slide a click gave the map, for the country it chose. */
type Slide = { location: string; x: number };

/** A country's colour: the accent mixed into the land by the square root of its share of the busiest, so small counts still show. */
function tint(count: number, max: number) {
	return count ? `color-mix(in oklab, rgb(var(--color-accent-500)) ${Math.round(100 * (0.25 + 0.75 * Math.sqrt(count / max)))}%, var(--map-land))` : "var(--map-land)";
}

const SPHERE = { type: "Sphere" as const };
/** Where the land reaches, north and south. A phone fits this to its height, so the sea runs past every edge of the screen. */
const LAND = { type: "MultiPoint" as const, coordinates: [[0, 80], [0, -62]] };
const PANEL_WIDTH = 22 * 16;
/** The results panel on the right, with its margin. */
const RESULTS_WIDTH = 33 * 16;
/** How far, at least, the map starts zoomed in on the library's countries on a wide screen. */
const START_ZOOM = 1.8;
/** How far past the screen's edges the map is drawn on a wide screen, so sliding it towards a chosen country never shows its edge. */
const PAD = 600;

const number = new Intl.NumberFormat();

function countryRows(facet: Record<string, number>) {
	return Object.entries(facet).flatMap(rowOf).sort((a, b) => b.count - a.count);
}

/** Only countries the region filter knows can be chosen, so only they are listed. */
function rowOf([code, count]: [string, number]): CountryRow[] {
	return COUNTRY_PARAMS[code] && count ? [{ code, name: COUNTRIES[code] ?? code, count: Number(count) }] : [];
}

function countryOf(geo: Feature, facet: Record<string, number>, chosen: string[]): Country {
	const code = A3ToA2[geo.id] as string | undefined;
	if (!code) return { name: geo.properties.name, count: 0, selected: false };
	const location = COUNTRY_PARAMS[code] as string | undefined;
	return { code, location, name: nameOf(code, geo), count: facet[code] ?? 0, selected: chosen.includes(location ?? "") };
}

function nameOf(code: string, geo: Feature) {
	return COUNTRIES[code] ?? geo.properties.name;
}

/** Where the map may draw on this screen, beside the country list when there is one (`listWidth`). On a phone the page starts
 * below the 80px header, and the globe's flat top stays hidden under the search bar. */
function frameOf(width: number, height: number, isDesktop: boolean, listWidth: number) {
	const bottom = height - 96;
	return isDesktop ? { width, height, bottom, listWidth, left: listWidth + 32, top: 120, pad: PAD } : { width, height, bottom, listWidth, left: 16, top: 40, pad: 0 };
}
type Frame = ReturnType<typeof frameOf>;
type View = NonNullable<ReturnType<typeof mapView>>;

/** The projection and starting point for this screen, centred on `focus`: the middle of the library's countries. */
function mapView(width: number | null, height: number | null, isDesktop: boolean, listWidth: number, focus?: [number, number]) {
	if (!width || !height) return null;
	const frame = frameOf(width, height, isDesktop, listWidth);
	return { frame, ...(isDesktop ? desktopView(frame, focus) : phoneView(frame, focus)) };
}

/** The globe turned so `focus` is on its middle meridian: the library's countries then never sit across the date line. */
function globeFor(focus?: [number, number]) {
	return geoEqualEarth().rotate([-(focus?.[0] ?? 0), 0]);
}

/** A phone gets the land at full height, wider than the screen, with the library's countries in the middle. */
function phoneView(frame: Frame, focus?: [number, number]) {
	const target = focus ?? [20, 0];
	const projection = globeFor(target).fitExtent([[frame.left, frame.top], [frame.left + 4 * (frame.bottom - frame.top), frame.bottom]], LAND);
	const [x] = projection(target)!;
	return { projection, center: projection.invert!([x, frame.height / 2]) as [number, number], minZoom: 1 };
}

/** A wide screen opens zoomed in on the library's countries, far enough in that the globe fills the screen from top to bottom,
 * with them in the middle of the space beside the list. Zooming out shows the whole globe there. */
function desktopView(frame: Frame, focus?: [number, number]) {
	const fitted = globeFor(focus).fitExtent([[frame.left, frame.top], [frame.width - 32, frame.bottom]], SPHERE);
	const [[, sphereTop], [, sphereBottom]] = geoPath(fitted).bounds(SPHERE);
	const zoom = focus ? Math.max(START_ZOOM, (frame.height + 48) / (sphereBottom - sphereTop)) : 1;
	const middle: [number, number] = [(frame.left + frame.width - 32) / 2, (frame.top + frame.bottom) / 2];
	const projection = globeFor(focus).scale(fitted.scale() * zoom).translate([0, 0]);
	const [x, y] = projection(focus ?? fitted.invert!(middle)!)!;
	const shiftY = middle[1] + frame.pad - y;
	projection.translate([middle[0] + frame.pad - x, focus ? coverY(projection, frame, shiftY) : shiftY]);
	return { projection, center: projection.invert!([frame.width / 2 + frame.pad, frame.height / 2 + frame.pad]) as [number, number], minZoom: 1 / zoom };
}

/** Moves the globe up or down only as far as keeps it covering the screen from top to bottom. */
function coverY(projection: ReturnType<typeof geoEqualEarth>, frame: Frame, y: number) {
	const [[, top], [, bottom]] = geoPath(projection).bounds(SPHERE);
	return Math.min(frame.pad - top, Math.max(frame.height + frame.pad - bottom, y));
}

/** The slide that puts a point at screen position `x` in the gap between the list and the results, no further than the map is drawn past the screen. */
function slideFrom(frame: Frame, x: number) {
	const gap = (frame.listWidth + frame.width - RESULTS_WIDTH) / 2;
	return Math.max(-frame.pad, Math.min(frame.pad, gap - x));
}

/** A country chosen by a click slides from where its shape is now, wherever the map has been moved. */
function slideTo(code: string, current: number, frame: Frame) {
	const shape = document.querySelector(`[data-country="${code}"]`)?.getBoundingClientRect();
	if (!shape) return current;
	return slideFrom(frame, shape.left + shape.width / 2 - current);
}

/** How far the map is slid: only on a wide screen (a phone has no `pad`), to the country chosen last. */
function offsetOf(view: View | null, chosen: string[], slide: Slide | null, places: Places) {
	const last = chosen.at(-1);
	if (!view?.frame.pad || !last) return 0;
	return slideFor(view, last, slide, places);
}

/** The slide a click gave this country, or else its slide from its place on the globe. */
function slideFor(view: View, location: string, slide: Slide | null, places: Places) {
	return slide?.location === location ? slide.x : placedSlide(view, places[location.split(" > ").at(-1)!]);
}

/** A country chosen in the address, before any click, slides from its place on the globe as the map first shows it. */
function placedSlide(view: View, place?: [number, number]) {
	const point = place && view.projection(place);
	return point ? slideFrom(view.frame, point[0] - view.frame.pad) : 0;
}

/** A keyboard user's tooltip sits over the country, kept inside the screen. */
function anchorOf(element: Element): Anchor {
	const bounds = element.getBoundingClientRect();
	return {
		x: Math.max(24, Math.min(window.innerWidth - 24, bounds.left + bounds.width / 2)),
		y: Math.max(100, Math.min(window.innerHeight - 80, bounds.top)),
	};
}

// Countries are cut apart by thin lines of sea. Pointing at one deepens it and outlines it in white; a selected one is deeper still.
const LIFTED = { fill: "color-mix(in oklab, rgb(var(--color-accent-500)), black 12%)", stroke: "white", strokeWidth: 1.5, outline: "none" };
const CHOSEN = { fill: "color-mix(in oklab, rgb(var(--color-accent-500)), black 22%)", stroke: "white", strokeWidth: 2, outline: "none" };

function shapeStyle(country: Country, hovered: string | null, max: number) {
	const rest = { fill: tint(country.count, max), stroke: "var(--map-sea)", strokeWidth: 0.6, outline: "none" };
	const active = activeStyle(country, rest);
	return { default: country.selected || hovered === country.code ? active : rest, hover: active, pressed: active };
}

/** A country without records doesn't change when pointed at. */
function activeStyle(country: Country, rest: React.CSSProperties) {
	return country.selected ? CHOSEN : country.count ? LIFTED : rest;
}

/** Only a country the region filter knows is a button. */
function roleOf(country: Country) {
	return country.location ? { role: "button", tabIndex: 0, "aria-pressed": country.selected } : { role: "img", tabIndex: -1 };
}

function isPress(event: React.KeyboardEvent) {
	return event.key === "Enter" || event.key === " ";
}

function CountryTip({ country }: { country: Country }) {
	const t = useTranslations("ui");
	return (
		<div className="flex flex-col gap-0.5 px-1 py-0.5">
			<div className="flex items-center gap-2 text-sm font-semibold">
				{country.code && <CountryFlag countryCode={country.code} className="h-3 w-[1.125rem] rounded-[2px]" />}
				{country.name}
			</div>
			<div className="text-xs text-black/60 dark:text-white/60">
				{t.rich("resourcesCount", {
					count: country.count,
					number: (value) => <strong className="font-semibold text-black dark:text-white">{value}</strong>,
				})}
			</div>
		</div>
	);
}

function CountryShape({ geo, country, style, onSelect, onShow, onHide }: { geo: Feature; country: Country; style: ReturnType<typeof shapeStyle>; onSelect: (code: string) => void; onShow: (country: Country, anchor: Anchor) => void; onHide: () => void }) {
	const t = useTranslations("ui");
	const select = () => {
		if (country.location) onSelect(country.code!);
	};
	return (
		<Geography
			geography={geo}
			{...roleOf(country)}
			aria-label={country.name}
			aria-description={t.markup("resourcesCount", { count: country.count, number: (value) => value })}
			data-country={country.code}
			onKeyDown={(event) => {
				if (!isPress(event)) return;
				event.preventDefault();
				if (!event.repeat) select();
			}}
			onClick={select}
			onMouseEnter={() => onShow(country, null)}
			onMouseLeave={onHide}
			onFocusCapture={(event) => onShow(country, anchorOf(event.currentTarget))}
			onBlurCapture={onHide}
			vectorEffect="non-scaling-stroke"
			className={twMerge("transition-[fill] duration-150 motion-reduce:transition-none", country.count > 0 && "cursor-pointer")}
			style={style}
		/>
	);
}

/** The globe: a shaded sea, Antarctica, a faint graticule and the countries, drawn past the screen's edges on a wide screen and slid sideways by `offset`. */
function Globe({ view, offset, inert, onMove, children }: { view: ReturnType<typeof mapView>; offset: number; inert: boolean; onMove: (data: unknown) => void; children: (geographies: Feature[]) => ReactNode }) {
	if (!view) return null;
	const { pad, width, height } = view.frame;
	return (
		<div className="absolute transition-transform duration-500 ease-out motion-reduce:transition-none" style={{ left: -pad, top: -pad, width: width + 2 * pad, height: height + 2 * pad, transform: `translateX(${offset}px)` }} inert={inert}>
			<ComposableMap projection={view.projection as never} width={width + 2 * pad} height={height + 2 * pad}>
				<defs>
					{/* The sea is lit from above the middle and darkens towards the rim, so the flat projection reads as a globe. */}
					<radialGradient id="map-sea-shade" cx="50%" cy="42%" r="66%">
						<stop offset="0%" stopColor="var(--map-sea-lit)" />
						<stop offset="62%" stopColor="var(--map-sea)" />
						<stop offset="100%" stopColor="var(--map-sea-rim)" />
					</radialGradient>
				</defs>
				<ZoomableGroup center={view.center} minZoom={view.minZoom} maxZoom={12} onMoveEnd={() => onMove(null)} onMove={onMove}>
					<Sphere id="map-sea" fill="url(#map-sea-shade)" stroke="none" strokeWidth={0} style={{ filter: "drop-shadow(0 24px 36px rgb(20 40 70 / 0.12))" }} />
					{/* Antarctica has no records and isn't in the countries file; it's drawn only so the globe's south isn't empty sea. */}
					<Geographies geography="/antarctica.json">
						{({ geographies }: { geographies: Feature[] }) => geographies.map((geo) => <Geography key={geo.rsmKey} geography={geo} tabIndex={-1} aria-hidden fill="var(--map-land)" stroke="var(--map-sea)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" style={{ default: { outline: "none" }, hover: { outline: "none" }, pressed: { outline: "none" } }} />)}
					</Geographies>
					<Graticule step={[15, 15]} stroke="rgb(20 40 70)" strokeOpacity={0.06} strokeWidth={0.5} vectorEffect="non-scaling-stroke" className="dark:[stroke:white]" />
					<Geographies geography={geoUrl}>{({ geographies }: { geographies: Feature[] }) => children(geographies)}</Geographies>
					<Sphere id="map-rim" fill="none" stroke="var(--map-sea-rim)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
				</ZoomableGroup>
			</ComposableMap>
		</div>
	);
}

function facetOf(props: ReturnType<typeof useItemsList>) {
	return (props.facetDistribution?.country_uncategorized ?? {}) as Record<string, number>;
}


function Search({ props }: { props: ReturnType<typeof useItemsList> }) {
	return (
		<div className="fixed top-20 md:bottom-0 md:top-auto left-0 z-10">
			<div className="w-screen md:w-[42rem] md:p-4">
				<div className="bg-white dark:bg-secondary-400 md:rounded-2xl flex gap-4 p-2 shadow-[0_-10px_10px_0_theme(colors.accent.500)] md:shadow-none">
					<SearchBar
						handleSearchChange={props.handleSearchChange}
						search={props.queryParams.search}
					/>
				</div>
			</div>
		</div>
	);
}

/** The library's countries, largest first, in the space above the search bar. The list doubles as the map's key: each bar has its country's colour. */
function CountryPanel({ props, rows, max, hovered, onHover, onSelect }: { props: ReturnType<typeof useItemsList>; rows: CountryRow[]; max: number; hovered: string | null; onHover: (code: string | null) => void; onSelect: (code: string) => void }) {
	const t = useTranslations("ui");
	const { theme } = useLibraryConfig();
	return (
		<div className={twMerge("fixed inset-y-0 left-0 z-10 pointer-events-none hidden w-[calc(22rem+1rem)] pb-24 pl-4 pt-[calc(7.5rem-1.5rem)] lg:block", theme.layout === "small" && "pt-[7.5rem]")}>
			<div className="pointer-events-auto flex h-full flex-col rounded-2xl bg-white pt-2 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.25)] dark:bg-secondary-400">
				<h2 className="flex items-baseline justify-between px-5 pb-1 pt-2 text-base font-semibold">
					{t("countries")}
					<span className="text-sm font-medium tabular-nums text-black/50 dark:text-white/50">{rows.length}</span>
				</h2>
				<ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-gutter:stable]" onPointerLeave={() => onHover(null)}>
					{rows.map((row) => {
						const selected = props.queryParams.country.includes(COUNTRY_PARAMS[row.code]);
						return (
							<li key={row.code}>
								<button
									type="button"
									aria-pressed={selected}
									onPointerEnter={() => onHover(row.code)}
									onFocus={() => onHover(row.code)}
									onBlur={() => onHover(null)}
									onClick={() => onSelect(row.code)}
									className={twMerge("flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent", hovered === row.code && "bg-black/5 dark:bg-white/5", selected && "bg-accent/15 dark:bg-accent/20")}
								>
									<CountryFlag countryCode={row.code} className="h-3.5 w-5 shrink-0 rounded-[3px]" />
									<span className="flex min-w-0 flex-1 flex-col gap-1.5">
										<TruncatedText text={row.name} className={twMerge("text-sm", selected ? "font-semibold" : "font-medium")} />
										<span aria-hidden className="block h-1 rounded-full bg-black/5 dark:bg-white/10">
											<span className="block h-full rounded-full" style={{ width: `${Math.max(2, (100 * row.count) / max)}%`, background: tint(row.count, max) }} />
										</span>
									</span>
									<span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">{number.format(row.count)}</span>
								</button>
							</li>
						);
					})}
				</ol>
			</div>
		</div>
	);
}


export default function Map({ focus, places }: { focus?: [number, number]; places: Places }) {
	const { search } = useLibraryConfig();
	const [tooltipContent, setTooltipContent] = useState<ReactNode | null>(
		null,
	);
	const [tooltipAnchor, setTooltipAnchor] = useState<Anchor>(null);
	const [zoomData, setZoomData] = useState<any>(null);
	const [hovered, setHovered] = useState<string | null>(null);
	const props = useItemsList(undefined, {
		paginationSiblings: 1,
		disableViewSwitch: true,
		interactionsStyle: "one-line",
	});
	const facet = facetOf(props);
	const rows = countryRows(facet);
	const maxItems = Math.max(1, ...rows.map((row) => row.count));
	const size = useWindowSize();
	const isDesktop = useBreakpoint("md");
	// The country list shows only where it and the results fit side by side.
	const listWidth = useBreakpoint("lg") ? PANEL_WIDTH + 16 : 0;
	const view = useMemo(() => mapView(size.width, size.height, isDesktop, listWidth, focus), [size.width, size.height, isDesktop, listWidth, focus]);
	const chosen = props.queryParams.country;

	// Choosing a country slides the map sideways so it sits in the gap between the two panels, in step with the results sliding in.
	const [slide, setSlide] = useState<Slide | null>(null);
	const offset = offsetOf(view, chosen, slide, places);
	const selectCountry = (code: string) => {
		const location = COUNTRY_PARAMS[code];
		if (!location) return;
		if (view && !chosen.includes(location)) setSlide({ location, x: slideTo(code, offset, view.frame) });
		props.handleCountrySelect(location);
	};
	const showCountry = (country: Country, anchor: Anchor) => {
		setTooltipAnchor(anchor);
		setTooltipContent(<CountryTip country={country} />);
		setHovered(country.code ?? null);
	};
	const hideCountry = () => {
		setTooltipAnchor(null);
		setTooltipContent(null);
		setHovered(null);
	};

	useEffect(() => {
		const country = props.queryParams.country;
		if (country.length === 0) {
			if (props.queryParams.sort) {
				props.handleSortChange(new Set([SORT_OPTIONS[0].key]));
			}
			if (props.queryParams.scope) {
				props.handleScopeChange(new Set([search.defaultScope]));
			}
			if (props.queryParams.page) {
				props.handlePageChange(1);
			}
		}
	}, [props.queryParams.country, search.defaultScope]);

	return (
		<main
			id="main-content"
			tabIndex={-1}
			className="relative w-full h-screen overflow-hidden [--map-land:rgb(246_244_239)] [--map-sea-lit:rgb(234_241_247)] [--map-sea-rim:rgb(200_214_227)] [--map-sea:rgb(216_228_238)] dark:[--map-land:rgb(62_66_74)] dark:[--map-sea-lit:rgb(30_39_53)] dark:[--map-sea-rim:rgb(17_22_31)] dark:[--map-sea:rgb(23_30_42)]"
		>
			<MouseTooltip
				content={tooltipContent}
				zoomData={zoomData}
				anchor={tooltipAnchor}
			/>
			<Search props={props} />
			<CountryPanel props={props} rows={rows} max={maxItems} hovered={hovered} onHover={setHovered} onSelect={selectCountry} />
			<MemoizedItemView props={props} />
			<Globe view={view} offset={offset} inert={!isDesktop && chosen.length > 0} onMove={setZoomData}>
				{(geographies) =>
					geographies.map((geo) => {
						const country = countryOf(geo, facet, chosen);
						return <CountryShape key={geo.rsmKey} geo={geo} country={country} style={shapeStyle(country, hovered, maxItems)} onSelect={selectCountry} onShow={showCountry} onHide={hideCountry} />;
					})
				}
			</Globe>
		</main>
	);
}
