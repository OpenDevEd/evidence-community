"use client";

import { geoEqualEarth, geoGraticule, geoPath } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity, zoomTransform, type ZoomTransform } from "d3-zoom";
import { feature } from "topojson-client";
import { flushSync } from "react-dom";
import { Fragment, ReactNode, Suspense, use, useEffect, useEffectEvent, useMemo, useState, useRef, memo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ArrowUp01Icon, Cancel01Icon, CenterFocusIcon, HelpCircleIcon, MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import HelpModal from "@/components/features/modals/HelpModal";
import { ScopeComponent, SortComponent } from "@/components/features/resources/LibrarySearchSelects";
import { Button } from "@/components/nextui/Button";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Tooltip } from "@/components/nextui/Tooltip";
import { CountryFlag } from "@/components/statistics/CountryFlag";
import { useMouse, useWindowSize } from "@uidotdev/usehooks";
import useSWR from "swr";
import type { FacetsGetResponse } from "@/app/api/facets/types";
import { buildFacetsQuery, fetcher } from "@/lib/utils";
import { RESULT_PARAMS } from "@/lib/searchParams";
import { useItemsList } from "@/hooks/useItemsList";
import { A3ToA2, COUNTRIES, COUNTRY_PARAMS } from "@/constants/misc";
import ItemsList from "../features/items/ItemsList";
import { Card } from "@/components/nextui/Card";
import { PANEL } from "./evidence/lists";
import { BackButton } from "./evidence/paper";
import { countryRows, listOf, measureOf, modeField, modeOf, modeParam, perPerson, scaleTop, shadeOf, totalIn, type CountryMode, type CountryRow, type Measure } from "./map-measure";
import { MapPanel, MapSheet, SIDE_WIDTH, useCountryMode, useMeasure } from "./map-panel";
import { TipFigures, useValueFormat } from "./map-figures";
import { DOT, useInstitutionLayer } from "./map-institutions";
import { SORT_OPTIONS } from "@/constants/items";
import { twMerge } from "@/lib/tw-merge";
import useBreakpoint from "@/hooks/useBreakpoint";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { INSTITUTION_FILTER_FIELD, institutionNameKey } from "@/config/library-config/institutions";
import { everyRecordScope, resolveRuntimeSearchScope, type RuntimeSearch } from "@/config/library-config/search";
import { tagSelections, WHOLE_LIBRARY_TAGS, type TagFilter } from "@/lib/tag-filters";

function MouseTooltip({
	content,
	anchor,
}: {
	content: ReactNode | null;
	anchor: { x: number; y: number } | null;
}) {
	const [mouse] = useMouse();
	const isDesktop = useBreakpoint("md");

	if (!isDesktop && !anchor) {
		return null;
	}

	const top = anchor?.y ?? mouse.y;
	const left = anchor?.x ?? mouse.x;
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

/** A chosen place's name: its country's, by the code that ends it. */
const placeName = (place: string) => {
	const code = place.split(" > ").at(-1)!;
	return COUNTRIES[code] ?? code;
};

/** The chosen institutions, one for all the spellings of each. */
const institutionsOf = (names: string[]) => names.filter((name, index) => names.findIndex((other) => institutionNameKey(other) === institutionNameKey(name)) === index);

/** What the results sheet's bar calls them: the chosen institution or country, how many are chosen, or a search's results. */
function resultsName(places: string[], t: ReturnType<typeof useTranslations<"ui">>, institutions: string[] = []) {
	const chosen = [...institutionsOf(institutions), ...places.map(placeName)];
	if (chosen.length > 1) return t("mapChosenCount", { count: chosen.length });
	return chosen[0] ?? t("resultsLabel");
}

/**
 * Whether the results sheet is open below 1,280 px: open when results first show and whenever the chosen countries change, and
 * otherwise as the reader left it, so folding it to watch the map while typing keeps it folded.
 */
function useResultsOpen(shown: boolean, chosen: string[]) {
	const [open, setOpen] = useState(true);
	// What opens it: the results showing, and each change of the chosen countries. Typing a search doesn't.
	const cause = shown ? chosen.join("|") : null;
	const [seen, setSeen] = useState(cause);
	if (cause !== seen) {
		setSeen(cause);
		setOpen(true);
	}
	return [open, setOpen] as const;
}

/** What has the focus, if it can be given it back. */
function focusedElement() {
	const active = document.activeElement;
	return active instanceof HTMLElement || active instanceof SVGElement ? active : null;
}

/** Gives the focus back to `opener` if the closing results hold it. */
function giveFocusBack(panel: HTMLElement | null, opener: HTMLElement | SVGElement | null) {
	if (panel?.contains(document.activeElement)) opener?.focus({ preventScroll: true });
}

/**
 * Focus is the outside system here. The results never take it, so typing carries on in the search; they keep what had it when
 * they opened, and give it back if they close while holding it (Clear all filters inside them). Returns the panel's ref.
 */
function useResultsFocus(shown: boolean) {
	const panelRef = useRef<HTMLDivElement>(null);
	const opener = useRef<HTMLElement | SVGElement | null>(null);
	useEffect(() => {
		if (shown) {
			opener.current ??= focusedElement();
			return;
		}
		giveFocusBack(panelRef.current, opener.current);
		opener.current = null;
	}, [shown]);
	return panelRef;
}

/** The results slide in from the right beside the wide panels, and up from the bottom as a sheet; a sheet's height changes glide. */
function resultsMotion(wide: boolean, still: boolean | null) {
	const away = wide ? { opacity: 0, x: 100 } : { y: "100%" };
	const transition = still ? { duration: 0 } : { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const };
	return { initial: away, exit: away, animate: { opacity: 1, x: 0, y: 0 }, transition, layout: !still && !wide };
}

/**
 * The results' head and band, in the greys of the panel on the left: help, the sort and the button that closes them, then the
 * search options. No title: the panel on the left and the chips under the count say what the results are of.
 */
function ResultsHead({ props }: { props: ReturnType<typeof useItemsList> }) {
	const t = useTranslations("ui");
	const [helpOpen, setHelpOpen] = useState(false);
	return (
		<>
			<div className="flex items-center gap-3 border-b border-black/[0.06] bg-[#e8eaef] p-3 dark:border-white/[0.08] dark:bg-black/25 [&>*]:h-12">
				<Button isIconOnly aria-label={t("helpAriaLabel")} className="h-full shrink-0 !p-0" onPress={() => setHelpOpen(true)}>
					<HugeiconsIcon icon={HelpCircleIcon} className="size-6" />
				</Button>
				<HelpModal isOpen={helpOpen} onOpenChange={setHelpOpen} />
				<SortComponent itemsContext={props} />
				<CloseResults props={props} />
			</div>
			<div className="border-b border-black/[0.06] bg-[#f2f3f6] p-3 dark:border-white/[0.08] dark:bg-black/10">
				<ScopeComponent itemsContext={props} />
			</div>
		</>
	);
}

/** From 1,280 px wide, where the results are a panel beside the map: clears the search and every filter, which closes the panel and
 * puts the map back to the whole library. Below that the sheet's back arrow closes it. */
function CloseResults({ props }: { props: ReturnType<typeof useItemsList> }) {
	const t = useTranslations("ui");
	const { search } = useLibraryConfig();
	const label = t("mapClearResults");
	return (
		<Button
			isIconOnly
			aria-label={label}
			className="hidden h-full !p-0 xl:flex"
			// The search field drops what was typed and is still waiting to run, or it would open the results again.
			data-drops-typed-search
			onPress={() => clearResults(props, search)}
		>
			<HugeiconsIcon icon={Cancel01Icon} className="size-6" />
		</Button>
	);
}

/** Clears the search and every filter, and the Documents scope where the library reads every record another way: alone it
 * still narrows the map to records with a PDF's text. */
function clearResults(props: ReturnType<typeof useItemsList>, search: RuntimeSearch) {
	props.handleClearFilters();
	props.handleSearchChange("");
	const every = everyRecordScope(search);
	if (every && resolveRuntimeSearchScope(props.queryParams.scope, search) === "documents") props.handleScopeChange(new Set([every]));
}

/** The sheet's bar: back to the list (`list`, the countries or the institutions), then what the results are of, which folds the
 * sheet (lying on its side, just the name). */
function ResultsBar({ name, list, open, onFold, onBack }: { name: string; list: "countries" | "institutions"; open: boolean; onFold: () => void; onBack: () => void }) {
	const t = useTranslations("ui");
	const label = t("resultsLabel");
	return (
		<div className="flex h-14 shrink-0 items-center gap-2 border-b border-black/[0.06] bg-[#e8eaef] pl-5 dark:border-white/[0.08] dark:bg-black/25 xl:hidden">
			<BackButton to={t(list)} onBack={onBack} />
			<h2 className="hidden min-w-0 flex-1 truncate pr-5 text-right text-sm font-semibold [@media(max-width:1279px)_and_(orientation:landscape)]:block">{name}</h2>
			{/* Named apart from the country's own button on the map, with what it shows in its name. */}
			<button type="button" aria-expanded={open} aria-label={name === label ? name : `${label}: ${name}`} onClick={onFold} className="flex h-full min-w-0 flex-1 items-center justify-end gap-3 pr-5 text-sm font-semibold outline-none hover:bg-[#e1e4ea] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent dark:hover:bg-black/30 [@media(max-width:1279px)_and_(orientation:landscape)]:hidden">
				<span className="truncate">{name}</span>
				<HugeiconsIcon icon={ArrowUp01Icon} size={16} aria-hidden className={twMerge("shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
			</button>
		</div>
	);
}

/** A search opens the results as choosing a country or an institution does. */
const resultsShown = ({ country, author_country, institution, search }: { country: string[]; author_country: string[]; institution: string[]; search: string }) => country.length + author_country.length + institution.length > 0 || Boolean(search);

/** The country under the pointer or the keyboard: its tooltip, where it shows, and which country is lifted. */
function useCountryTooltip() {
	const [tooltipContent, setTooltipContent] = useState<ReactNode | null>(null);
	const [tooltipAnchor, setTooltipAnchor] = useState<Anchor>(null);
	const [hovered, setHovered] = useState<string | null>(null);
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
	return { tooltipContent, tooltipAnchor, hovered, setHovered, showCountry, hideCountry, setTooltipContent, setTooltipAnchor };
}

/** Where choosing a country in this mode puts it: the country focus filter, or the authors' countries. */
const choosePlace = (props: ReturnType<typeof useItemsList>, mode: CountryMode) => (mode === "focus" ? props.handleCountrySelect : props.handleAuthorCountrySelect);

/** With the results closed, they open next time on their first page in the default order. */
function useFreshResults(props: ReturnType<typeof useItemsList>) {
	useEffect(() => {
		if (!resultsShown(props.queryParams)) {
			if (props.queryParams.sort) {
				props.handleSortChange(new Set([SORT_OPTIONS[0].key]));
			}
			if (props.queryParams.page) {
				props.handlePageChange(1);
			}
		}
	}, [props.queryParams.country, props.queryParams.author_country, props.queryParams.institution, props.queryParams.search]);
}

/** The places chosen in either mode. */
const chosenPlaces = ({ country, author_country }: { country: string[]; author_country: string[] }) => [...country, ...author_country];

/** Where the results sit: a panel on the right from 1,280 px wide, below the header's height when the library's header is small;
 * below that a sheet along the bottom, half the screen or folded to its bar, or down the right side lying down. */
function resultsClass(open: boolean, small: boolean) {
	return twMerge(
		"fixed inset-x-0 bottom-0 z-30 [@media(max-width:1279px)_and_(orientation:landscape)]:left-auto [@media(max-width:1279px)_and_(orientation:landscape)]:top-[5.75rem] [@media(max-width:1279px)_and_(orientation:landscape)]:h-auto xl:inset-y-0 xl:left-auto xl:right-0 xl:top-0 xl:h-auto xl:pb-4 xl:pr-4 xl:pt-[calc(7.5rem-1.5rem)]",
		// The phone's home indicator keeps its own room under the bar.
		"pb-[env(safe-area-inset-bottom)]",
		open ? "h-[50dvh]" : "h-[calc(3.5rem+env(safe-area-inset-bottom))]",
		SIDE_WIDTH,
		small && "xl:pt-[7.5rem]",
	);
}

/**
 * The chosen countries' records, or a search's: the library's full results, as before. From 1,280 px wide in a panel on the right,
 * beside the countries' panel. Below, a sheet over the countries' sheet, with the back arrow to the countries: it folds to its bar
 * so the map shows with the search still on, and lying on its side it takes the right side.
 */
function ItemView({ props, list }: { props: ReturnType<typeof useItemsList>; list: "countries" | "institutions" }) {
	const shown = resultsShown(props.queryParams);
	const [open, setOpen] = useResultsOpen(shown, [...chosenPlaces(props.queryParams), ...props.queryParams.institution]);
	const small = useLibraryConfig().theme.layout === "small";
	const t = useTranslations("ui");
	const motionProps = resultsMotion(useBreakpoint("xl"), useReducedMotion());
	const panelRef = useResultsFocus(shown);
	return (
		<AnimatePresence>
			{shown && (
				<motion.div
					ref={panelRef}
					role="region"
					aria-label={t("resultsLabel")}
					{...motionProps}
					className={resultsClass(open, small)}
				>
					<div className={twMerge(PANEL, "flex h-full w-full flex-col overflow-hidden rounded-b-none xl:w-[32rem] xl:rounded-2xl")}>
						<ResultsBar list={list} name={resultsName(chosenPlaces(props.queryParams), t, props.queryParams.institution)} open={open} onFold={() => setOpen(!open)} onBack={() => { props.handleCountriesClear(); props.handleSearchChange(""); }} />
						<div className={twMerge("min-h-0 flex-1 flex-col overflow-hidden xl:flex xl:rounded-2xl [@media(max-width:1279px)_and_(orientation:landscape)]:flex", open ? "flex" : "hidden")}>
							{/* The head stays put while the results scroll under it, as the countries' panel does. */}
							<ResultsHead props={props} />
							<div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
								<Card color="card" className="min-h-full rounded-none p-4 shadow-none">
									<ItemsList props={props} contentId="map-results" headless />
								</Card>
							</div>
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

const MemoizedItemView = memo(ItemView, (prevProps, nextProps) => {
	return prevProps.props === nextProps.props && prevProps.list === nextProps.list;
});

type Feature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { name: string }> & { id: string };
/** The outlines the globe draws: the countries, and Antarctica, which has no records and isn't in the countries file. */
type World = { countries: Feature[]; antarctica: Feature[] };
/** A country on the map: `location` is its place in the region filter, when it has one. */
type Country = { code?: string; location?: string; name: string; count: number; /** Its records in the whole library, while the map is narrowed. */ total?: number; value: number | null; selected: boolean };
type Anchor = { x: number; y: number } | null;
/** Each country's place on the globe, by code. */
type Places = Record<string, [number, number]>;
/** The slide a click gave the map, for the country it chose. */
type Slide = { location: string; x: number };

/** A country's colour: the accent mixed into the land by the square root of its share of the highest value, so small values still show. */
function tint(value: number | null, max: number) {
	return value ? `color-mix(in oklab, rgb(var(--color-accent-500)) ${Math.round(100 * (0.25 + 0.75 * Math.sqrt(Math.min(1, value / max))))}%, var(--map-land))` : "var(--map-land)";
}

const SPHERE = { type: "Sphere" as const };
/** Where the land reaches, north and south. A phone fits this to its height, so the sea runs past every edge of the screen. */
const LAND = { type: "MultiPoint" as const, coordinates: [[0, 80], [0, -62]] };
/** The panel down the left, with its margin, from 1,280 px wide. */
const PANEL_WIDTH = 24 * 16;
/** The results panel on the right, with its margin, from 1,280 px wide. */
const RESULTS_WIDTH = 33 * 16;
/** How far, at least, the map starts zoomed in on the library's countries on a wide screen. */
const START_ZOOM = 1.8;
/** How far past the screen's edges the map is drawn on a wide screen, so sliding it towards a chosen country never shows its edge. */
const PAD = 600;

function countryOf(geo: Feature, facet: Record<string, number>, chosen: string[], measure: Measure, totals?: Record<string, number>): Country {
	const code = A3ToA2[geo.id] as string | undefined;
	if (!code) return { name: geo.properties.name, count: 0, value: null, selected: false };
	return { ...placedCountry(code, geo, facet[code] ?? 0, chosen, measure), total: totalIn(totals, code) };
}

/** A country the library knows by code: where the region filter puts it, its records, its value, and whether it is chosen. */
function placedCountry(code: string, geo: Feature, count: number, chosen: string[], measure: Measure): Country {
	const location = COUNTRY_PARAMS[code] as string | undefined;
	return { code, location, name: nameOf(code, geo), count, value: measureOf(code, count, measure), selected: chosen.includes(location as string) };
}

function nameOf(code: string, geo: Feature) {
	return COUNTRIES[code] ?? geo.properties.name;
}

/** Where the map may draw on this screen, beside the country list when there is one (`listWidth`). On a phone the page starts
 * below the 80px header, and the globe's flat top stays hidden under the search bar. */
function frameOf(width: number, height: number, isDesktop: boolean, listWidth: number) {
	const bottom = height - 96;
	const side = sideOf(width, height, listWidth);
	return isDesktop ? { width, height, bottom, listWidth, side, left: listWidth + 32, top: 120, pad: PAD } : { width, height, bottom, listWidth, side, left: 16, top: 40, pad: 0 };
}

/** Below 1,280 px lying on its side, the sheet covers the right of the screen (as wide as `SIDE_WIDTH`), so the map centres left of it. */
function sideOf(width: number, height: number, listWidth: number) {
	return !listWidth && width > height ? Math.min(32 * 16, 0.55 * width) : 0;
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
	const [left, top] = projection.translate();
	return { projection: projection.translate([left + (frame.width - frame.side) / 2 - x, top]), minZoom: 1 };
}

/** A wide screen opens zoomed in on the library's countries, far enough in that the globe fills the screen from top to bottom,
 * with them in the middle of the space beside the list. Zooming out shows the whole globe there. */
function desktopView(frame: Frame, focus?: [number, number]) {
	const right = frame.width - 32 - frame.side;
	const fitted = globeFor(focus).fitExtent([[frame.left, frame.top], [right, frame.bottom]], SPHERE);
	const [[, sphereTop], [, sphereBottom]] = geoPath(fitted).bounds(SPHERE);
	const zoom = focus ? Math.max(START_ZOOM, (frame.height + 48) / (sphereBottom - sphereTop)) : 1;
	const middle: [number, number] = [(frame.left + right) / 2, (frame.top + frame.bottom) / 2];
	const projection = globeFor(focus).scale(fitted.scale() * zoom).translate([0, 0]);
	const [x, y] = projection(focus ?? fitted.invert!(middle)!)!;
	const shiftY = middle[1] + frame.pad - y;
	projection.translate([middle[0] + frame.pad - x, focus ? coverY(projection, frame, shiftY) : shiftY]);
	return { projection, minZoom: 1 / zoom };
}

/** Moves the globe up or down only as far as keeps it covering the screen from top to bottom. */
function coverY(projection: ReturnType<typeof geoEqualEarth>, frame: Frame, y: number) {
	const [[, top], [, bottom]] = geoPath(projection).bounds(SPHERE);
	return Math.min(frame.pad - top, Math.max(frame.height + frame.pad - bottom, y));
}

/** The slide that puts a point at screen position `x` in the gap between the panel and the results (only from 1,280 px wide, where
 * the panel is, are the results beside the map), no further than the map is drawn past the screen. */
function slideFrom(frame: Frame, x: number) {
	const gap = (frame.listWidth + frame.width - (frame.listWidth ? RESULTS_WIDTH : frame.side)) / 2;
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

/** The map's mode in the address, where the library offers it: Country Focus otherwise. */
function useOfferedMode() {
	const [by, setMode] = useCountryMode();
	const institutions = useLibraryConfig().filters.institution.mode !== "hidden";
	return [modeOf(by, institutions), setMode] as const;
}

/** The panel shows from 1,280 px wide; below that the map has the width and a sheet holds the list. */
function useListWidth() {
	return useBreakpoint("xl") ? PANEL_WIDTH : 0;
}

/** The slide back to where the last chosen country started, none with no country chosen (the map isn't slid then). */
function slideBack(chosen: string[]): Slide | null {
	const last = chosen.at(-1);
	return last ? { location: last, x: 0 } : null;
}

/** A keyboard user's tooltip sits over the country, kept inside the screen. */
function anchorOf(element: Element): Anchor {
	const bounds = element.getBoundingClientRect();
	return {
		x: Math.max(24, Math.min(window.innerWidth - 24, bounds.left + bounds.width / 2)),
		y: Math.max(100, Math.min(window.innerHeight - 80, bounds.top)),
	};
}

/** A line `width` pixels wide on screen at any zoom: the map's zoom (`--map-k`) is set only when a gesture ends, so while one runs the
 * lines scale with the map instead of Firefox redrawing every outline on every frame. */
function line(width: number) {
	return `calc(${width}px / var(--map-k))`;
}

// Countries are cut apart by thin lines of sea. Pointing at one deepens it and outlines it in white; a selected one is deeper still.
const LIFTED = { fill: "color-mix(in oklab, rgb(var(--color-accent-500)), black 12%)", stroke: "white", strokeWidth: line(1.5) };
const CHOSEN = { fill: "color-mix(in oklab, rgb(var(--color-accent-500)), black 22%)", stroke: "white", strokeWidth: line(2) };

function shapeStyle(country: Country, hovered: string | null, max: number): React.CSSProperties {
	const rest = { fill: tint(country.value, max), stroke: "var(--map-sea)", strokeWidth: line(0.6) };
	return country.selected || hovered === country.code ? activeStyle(country, rest) : rest;
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

/** The country pointed at: its flag and name, then its figures in the whole library and, while the map is narrowed, now. */
function CountryTip({ country }: { country: Country }) {
	return (
		<div className="flex flex-col gap-0.5 px-1 py-0.5">
			<div className="flex items-center gap-2 text-sm font-semibold">
				{country.code && <CountryFlag countryCode={country.code} className="h-3 w-[1.125rem] rounded-[2px]" />}
				{country.name}
			</div>
			<TipFigures total={country.total} count={country.count} perMillion={(count) => perPerson(country.code, count)} />
		</div>
	);
}

function CountryShape({ d, country, style, onSelect, onShow, onHide }: { d: string; country: Country; style: React.CSSProperties; onSelect: (code: string) => void; onShow: (country: Country, anchor: Anchor) => void; onHide: () => void }) {
	const t = useTranslations("ui");
	const select = () => {
		if (country.location) onSelect(country.code!);
	};
	return (
		<path
			d={d}
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
			onFocus={(event) => onShow(country, anchorOf(event.currentTarget))}
			onBlur={onHide}
			className={twMerge("outline-none", country.count > 0 && "cursor-pointer")}
			style={style}
		/>
	);
}

const WORLD_FILES = ["/features.json", "/antarctica.json"];
let world: Promise<World | null> | undefined;

/** The outlines, fetched once per page load; the page preloads both files, so this usually finds them downloaded. A failure is
 * logged and leaves the map out for this page load rather than breaking the page; the failure stays cached, so Suspense
 * doesn't fetch again on every retry. */
function loadWorld() {
	world ??= Promise.all(WORLD_FILES.map((url) => fetch(url).then(jsonOf)))
		.then(([topology, antarctica]) => ({ countries: feature(topology, topology.objects.world).features as Feature[], antarctica: antarctica.features }))
		.catch((error: unknown) => {
			console.error("Map: the world outlines could not be loaded", error);
			return null;
		});
	return world;
}

// The outlines start parsing as soon as this script runs in the browser, while the page is still hydrating.
if (typeof window !== "undefined") void loadWorld();

async function jsonOf(response: Response) {
	if (!response.ok) throw new Error(`${response.url} answered ${response.status}`);
	return response.json();
}

/** How long a zoom button's glide takes, in milliseconds. */
const GLIDE = 320;
/** The sideways slide to a chosen country: `duration-500` on the stage. */
const SLIDE = 500;
/** The zoom buttons' way into d3-zoom, set while the globe is on the page. */
type Zoomer = { zoomBy: (k: number) => void; reset: () => void };

const GRATICULE = geoGraticule().step([15, 15])();

/** How a gesture moves the drawn map, from the zoom the SVG was drawn at (`from`) to where the gesture is now (`to`). */
function cssTransform(from: ZoomTransform, to: ZoomTransform) {
	const scale = to.k / from.k;
	return `translate(${to.x - scale * from.x}px, ${to.y - scale * from.y}px) scale(${scale})`;
}

/** The globe, once its outlines have arrived. Until then the page shows nothing here, and the globe fades in whole when they do.
 * `hidden` in the page's placeholder: without the library's countries the globe would open on the whole world, then jump. */
function Globe({ view, hidden, ...rest }: { view: View | null; hidden?: boolean } & Omit<Parameters<typeof GlobeView>[0], "view" | "world">) {
	if (!view || hidden) return null;
	const loaded = use(loadWorld());
	return loaded && <GlobeView view={view} world={loaded} {...rest} />;
}

/** A shaded sea, Antarctica, a faint graticule and the countries, drawn past the screen's edges on a wide screen and slid sideways by `offset`.
 * Zooming and panning move the drawn map as one composited layer with a CSS transform, so Firefox redraws nothing while a gesture runs;
 * when it ends, the zoom is committed to the SVG and the outlines are redrawn sharp at the new scale. Nothing here is blurred or
 * transitioned: Firefox redraws a blur, or a fading fill, across the whole globe on every frame, which kept a core or more busy. */
function GlobeView({ view, world, offset, zoomerRef, renderCountry, overlay }: { view: View; world: World; offset: number; zoomerRef: React.RefObject<Zoomer | null>; renderCountry: (geo: Feature, d: string) => ReactNode; /** Drawn over the countries in the globe's projection, such as the institutions' circles. */ overlay: (projection: View["projection"]) => ReactNode }) {
	const stage = useRef<HTMLDivElement>(null);
	// The buttons zoom about the middle of the space beside the panel, in the stage's own coordinates, wherever the map is slid.
	const middle = useEffectEvent((): [number, number] => [(view.frame.listWidth + view.frame.width) / 2 + view.frame.pad - offset, view.frame.height / 2 + view.frame.pad]);
	const layer = useRef<HTMLDivElement>(null);
	const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
	const { pad, width, height } = view.frame;
	// While the map slides to a chosen country the pointer stays still and countries pass under it: it is ignored until the
	// slide ends, so no tooltip flicks from one to the next.
	const still = useReducedMotion();
	const [settledAt, setSettledAt] = useState(offset);
	// Without motion there is no slide to wait for: it has settled already, also if motion comes back later.
	if (still && settledAt !== offset) setSettledAt(offset);
	const sliding = settledAt !== offset;
	// A slide that never runs or is cut short sends no `transitionend`: the map moved while the page was kept for Back, or Back and
	// Forward crossed mid-slide. Without this timer the map would ignore the pointer until a reload.
	useEffect(() => {
		if (!sliding) return;
		const timer = setTimeout(() => setSettledAt(offset), SLIDE + 50);
		return () => clearTimeout(timer);
	}, [sliding, offset]);
	const drawn = useMemo(() => {
		const draw = geoPath(view.projection);
		return { sea: draw(SPHERE) ?? "", graticule: draw(GRATICULE) ?? "", antarctica: world.antarctica.map((geo) => draw(geo) ?? ""), countries: world.countries.map((geo) => draw(geo) ?? "") };
	}, [view.projection, world]);

	// d3-zoom is an outside system: it listens for the pointer, wheel and touch on the stage until the globe goes away.
	useEffect(() => {
		const element = stage.current!;
		const moving = layer.current!;
		// The zoom the SVG was last drawn at. Gestures can overlap (a drag starting while a wheel gesture is settling), so every frame
		// moves the layer from this, and a gesture's end redraws the SVG at the zoom as it is then.
		let committed = zoomTransform(element);
		let active = 0;
		// A button's glide whose redraw is still to come: a new gesture redraws it first, so it starts from where the glide went.
		let pending: ((sync: boolean) => void) | null = null;
		const behaviour = zoom<HTMLDivElement, unknown>()
			.scaleExtent([view.minZoom, 12])
			.duration(0)
			.on("start", (event: { sourceEvent: unknown }) => {
				pending?.(true);
				active += 1;
				// A reader's own gesture moves the map at once, even over a button's glide.
				if (event.sourceEvent) moving.style.transition = "";
				moving.style.willChange = "transform";
			})
			.on("zoom", (event: { transform: ZoomTransform }) => {
				moving.style.transform = cssTransform(committed, event.transform);
			})
			.on("end", (event: { transform: ZoomTransform }) => {
				// Redrawn at once mid-page, so the next frame is sharp; on the effect's cleanup, where React can't render at once, later.
				const commit = (sync = true) => {
					active -= 1;
					committed = event.transform;
					if (sync) flushSync(() => setTransform(committed));
					else setTransform(committed);
					moving.style.transition = "";
					moving.style.transform = "";
					if (!active) moving.style.willChange = "";
				};
				if (!moving.style.transition) return commit();
				// A button's zoom glides the layer there first, then draws the outlines sharp at the new zoom. A glide that goes
				// nowhere never ends, so the commit also runs after the glide's length.
				const ended = () => once(true);
				const timer = setTimeout(ended, GLIDE + 50);
				const once = (sync: boolean) => {
					pending = null;
					clearTimeout(timer);
					moving.removeEventListener("transitionend", ended);
					commit(sync);
				};
				pending = once;
				moving.addEventListener("transitionend", ended, { once: true });
			});
		select(element).call(behaviour);
		const glide = (move: () => void) => {
			if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) moving.style.transition = `transform ${GLIDE}ms cubic-bezier(0.22, 1, 0.36, 1)`;
			move();
		};
		zoomerRef.current = {
			zoomBy: (k) => glide(() => behaviour.scaleBy(select(element), k, middle())),
			reset: () => glide(() => behaviour.transform(select(element), zoomIdentity)),
		};
		return () => {
			// A glide still on its way when the map is set up again is finished now, so it can't land on the new one.
			pending?.(false);
			zoomerRef.current = null;
			select(element).on(".zoom", null);
		};
	}, [view.minZoom, view.frame, zoomerRef]);

	return (
		<div ref={stage} className="absolute transition-transform duration-500 ease-out motion-reduce:transition-none" style={{ left: -pad, top: -pad, width: width + 2 * pad, height: height + 2 * pad, transform: `translateX(${offset}px)`, pointerEvents: sliding ? "none" : undefined }} onTransitionEnd={(event) => { if (event.target === event.currentTarget) setSettledAt(offset); }}>
			<div ref={layer} className="size-full origin-top-left animate-fade-in motion-reduce:animate-none" style={{ "--map-k": transform.k } as React.CSSProperties}>
				{/* Not clipped to its box: while a gesture moves the layer, the geography beyond the box slides into view instead of blank space. */}
				<svg width={width + 2 * pad} height={height + 2 * pad} overflow="visible" className="block">
					<defs>
						{/* The sea is lit from above the middle and darkens towards the rim, so the flat projection reads as a globe. */}
						<radialGradient id="map-sea-shade" cx="50%" cy="42%" r="66%">
							<stop offset="0%" stopColor="var(--map-sea-lit)" />
							<stop offset="62%" stopColor="var(--map-sea)" />
							<stop offset="100%" stopColor="var(--map-sea-rim)" />
						</radialGradient>
					</defs>
					<g transform={transform.toString()}>
						<g aria-hidden>
							<path d={drawn.sea} fill="url(#map-sea-shade)" />
							{drawn.antarctica.map((d, index) => <path key={index} d={d} fill="var(--map-land)" stroke="var(--map-sea)" style={{ strokeWidth: line(0.6) }} />)}
							<path d={drawn.graticule} fill="none" stroke="rgb(20 40 70)" strokeOpacity={0.06} style={{ strokeWidth: line(0.5) }} className="dark:[stroke:white]" />
						</g>
						{world.countries.map((geo, index) => <Fragment key={index}>{renderCountry(geo, drawn.countries[index])}</Fragment>)}
						<path aria-hidden d={drawn.sea} fill="none" stroke="var(--map-sea-rim)" style={{ strokeWidth: line(1) }} />
						{overlay(view.projection)}
					</g>
				</svg>
			</div>
		</div>
	);
}

const NO_COUNTS: Record<string, number> = {};
const COUNTS_OPTIONS = { keepPreviousData: true, revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false };

/**
 * The countries' record counts the map colours and ranks by: the page's own filters, chosen countries included, so choosing a
 * country shows it and the other countries its records name, where they collaborate. It is the shared filters' own request.
 * Until it answers, the counts the server sent with the page; while a new one is on its way, the last ones, marked as stale.
 */
function useCountryCounts(params: ReturnType<typeof useItemsList>["queryParams"], mode: CountryMode, initial?: Record<string, number>) {
	const { data, isValidating } = useSWR<FacetsGetResponse>(buildFacetsQuery(params), fetcher, COUNTS_OPTIONS);
	// The server counted for the mode the page opened in.
	const [firstMode] = useState(mode);
	const facet = countsIn(data, mode, mode === firstMode ? initial : undefined);
	// Nothing shown yet is nothing stale.
	return { facet, stale: isValidating && facet !== NO_COUNTS };
}

/** Whether a search, a filter, a chosen place or the Documents scope narrows the map. The other scopes only choose which fields a
 * search reads, so alone they narrow nothing; so does Documents where it is the only scope. A tag filter's defaults narrow it too,
 * though the address doesn't name them. */
const narrows = (params: ReturnType<typeof useItemsList>["queryParams"], search: RuntimeSearch, tagFilters: readonly TagFilter[]) =>
	(everyRecordScope(search) !== undefined && resolveRuntimeSearchScope(params.scope, search) === "documents") ||
	RESULT_PARAMS.some((key) => key !== "scope" && key !== "tags" && params[key].length > 0) ||
	Object.values(tagSelections(params.tags, tagFilters)).some((ticked) => ticked.length > 0);

/** The whole library: no filter, and a scope that reads every record. */
const wholeLibrary = (search: RuntimeSearch) => ({ scope: everyRecordScope(search) ?? "", tags: WHOLE_LIBRARY_TAGS });

/**
 * The whole library's counts, for the tooltips' first line: its countries in the mode and its institutions. Only while the map is
 * narrowed.
 */
function useLibraryTotals(params: ReturnType<typeof useItemsList>["queryParams"], mode: CountryMode) {
	const { search, filters } = useLibraryConfig();
	const library = useSWR<FacetsGetResponse>(buildFacetsQuery(wholeLibrary(search)), fetcher, COUNTS_OPTIONS).data;
	if (!narrows(params, search, filters.tagFilters) || !library) return {};
	return { countries: countsIn(library, mode), institutions: library.facetDistribution?.[INSTITUTION_FILTER_FIELD] as Record<string, number> | undefined };
}

/** The counts the answer gives for the mode, or the server's, or none. */
const countsIn = (data: FacetsGetResponse | undefined, mode: CountryMode, initial?: Record<string, number>) =>
	(data?.facetDistribution?.[`${modeField(mode)}_uncategorized`] ?? initial ?? NO_COUNTS) as Record<string, number>;

/** `counts` are the countries' record counts for the page's filters, so the list and the colours are there from the first frame.
 * `pending` is the page's placeholder while the server reads them: it draws no globe, which without the library's countries would
 * open on the whole world and then jump to them when the page replaces it. */
export default function Map({ focus, places, counts, pending }: { focus?: [number, number]; places: Places; counts?: Record<string, number>; pending?: boolean }) {
	const { tooltipContent, tooltipAnchor, hovered, setHovered, showCountry, hideCountry, setTooltipContent, setTooltipAnchor } = useCountryTooltip();
	const props = useItemsList(undefined, {
		paginationSiblings: 1,
		disableViewSwitch: true,
		interactionsStyle: "one-line",
	});
	const [measure, setMeasure] = useMeasure();
	const [mode, setMode] = useOfferedMode();
	const chosen = props.queryParams[modeParam(mode)];
	const { facet, stale } = useCountryCounts(props.queryParams, mode, counts);
	const shade = shadeOf(mode, measure);
	const rows = countryRows(facet, shade);
	const max = scaleTop(rows, shade);
	const totals = useLibraryTotals(props.queryParams, mode);
	const layer = useInstitutionLayer({ props, enabled: mode === "institutions", totals: totals.institutions, setTooltipContent, setTooltipAnchor });
	const size = useWindowSize();
	const isDesktop = useBreakpoint("md");
	const smallLayout = useLibraryConfig().theme.layout === "small";
	const listWidth = useListWidth();
	const view = useMemo(() => mapView(size.width, size.height, isDesktop, listWidth, focus), [size.width, size.height, isDesktop, listWidth, focus]);
	const zoomerRef = useRef<Zoomer | null>(null);

	// Choosing a country slides the map sideways so it sits in the gap between the two panels, in step with the results sliding in.
	const [slide, setSlide] = useState<Slide | null>(null);
	const offset = offsetOf(view, chosen, slide, places);
	// Back to the library's countries: the slide to the chosen country goes too.
	const resetSlide = () => setSlide(slideBack(chosen));
	const selectCountry = (code: string) => {
		const location = COUNTRY_PARAMS[code];
		if (!location) return;
		if (view && !chosen.includes(location)) setSlide({ location, x: slideTo(code, offset, view.frame) });
		// The tooltip closes on the click, as the map moves the country away from under the pointer.
		hideCountry();
		choosePlace(props, mode)(location);
	};
	// Another mode counts other places: what was chosen in the last one goes, so the results never stay filtered by it unseen.
	const changeMode = (next: CountryMode) => {
		props.handleCountriesClear();
		setSlide(null);
		void setMode(next);
	};
	useFreshResults(props);

	const panel = { institutions: layer.panel, props, chosen, mode, onMode: changeMode, rows, stale, measure, onMeasure: (next: Measure) => void setMeasure(next), tint: (value: number | null) => tint(value, max), hovered, onHover: setHovered, onSelect: selectCountry, smallLayout };
	return (
		<main
			id="main-content"
			tabIndex={-1}
			className="relative w-full h-screen overflow-hidden [--map-land:rgb(246_244_239)] [--map-sea-lit:rgb(234_241_247)] [--map-sea-rim:rgb(200_214_227)] [--map-sea:rgb(216_228_238)] dark:[--map-land:rgb(62_66_74)] dark:[--map-sea-lit:rgb(30_39_53)] dark:[--map-sea-rim:rgb(17_22_31)] dark:[--map-sea:rgb(23_30_42)]"
		>
			<MouseTooltip
				content={tooltipContent}
				anchor={tooltipAnchor}
			/>
			<MapPanel {...panel} />
			<MapSheet {...panel} />
			<MemoizedItemView props={props} list={listOf(mode)} />
			<ZoomControls zoomerRef={zoomerRef} onReset={resetSlide} />
			<MapLegend rows={rows} measure={shade} max={max} institutions={mode === "institutions"} />
			<Suspense fallback={null}>
				<Globe
					hidden={pending}
					view={view}
					offset={offset}
					zoomerRef={zoomerRef}
					renderCountry={(geo, d) => {
						const country = countryOf(geo, facet, chosen, shade, totals.countries);
						return <CountryShape d={d} country={country} style={shapeStyle(country, hovered, max)} onSelect={selectCountry} onShow={showCountry} onHide={hideCountry} />;
					}}
					overlay={layer.overlay}
				/>
			</Suspense>
		</main>
	);
}

/** What the key's scale counts, by the measure the countries are coloured by. */
const LEGEND_TITLE = { people: "mapResourcesPerMillion", records: "mapResourcesPerCountry" } as const;

/**
 * The key to the countries' colours, beside the zoom buttons from 1,280 px wide: the tint's scale, and the circles in the
 * institutions' mode. Nothing while no country has a value.
 */
function MapLegend({ rows, measure, max, institutions }: { rows: CountryRow[]; measure: Measure; max: number; institutions: boolean }) {
	const t = useTranslations("ui");
	const values = rows.flatMap((row) => (row.value ? [row.value] : []));
	if (!values.length) return null;
	return (
		<div className={twMerge(PANEL, "fixed bottom-4 left-[calc(24rem+3.75rem)] z-10 hidden w-52 px-3 py-2.5 text-xs leading-5 xl:block")}>
			<LegendScale values={values} measure={measure} max={max} />
			{institutions && (
				<p className="mt-1.5 flex items-center gap-2">
					<span className="size-2.5 rounded-full" style={{ background: DOT }} />
					{t("institutions")}
				</p>
			)}
		</div>
	);
}

/** The tint from the lowest value to the one that takes the full colour. Per person a few small states go past it, so it reads "and more". */
function LegendScale({ values, measure, max }: { values: number[]; measure: Measure; max: number }) {
	const t = useTranslations("ui");
	const format = useValueFormat()[measure === "people" ? "rate" : "count"];
	const low = Math.min(...values);
	const stops = [low, ...[0.1, 0.3, 0.6, 1].map((share) => share * max)].map((value) => tint(value, max));
	const top = format(max);
	return (
		<>
			<p className="mb-1.5 font-semibold">{t(LEGEND_TITLE[measure])}</p>
			<span aria-hidden className="block h-2 rounded-full" style={{ background: `linear-gradient(to right, ${stops.join(", ")})` }} />
			<p className="mt-0.5 flex justify-between tabular-nums text-black/55 dark:text-white/55">
				<span>{format(low)}</span>
				<span>{Math.max(...values) > max ? t("mapAndMore", { value: top }) : top}</span>
			</p>
		</>
	);
}

/** Zoom, from 1,280 px wide: at the map's bottom left, beside the panel, as on the evidence map. */
function ZoomControls({ zoomerRef, onReset }: { zoomerRef: React.RefObject<Zoomer | null>; onReset: () => void }) {
	const t = useTranslations("ui");
	const button = "grid size-9 place-items-center rounded-xl outline-none transition-colors hover:bg-black/[0.05] focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/10";
	const controls = [
		{ label: t("mapZoomIn"), icon: PlusSignIcon, act: (zoomer: Zoomer) => zoomer.zoomBy(1.6) },
		{ label: t("mapZoomOut"), icon: MinusSignIcon, act: (zoomer: Zoomer) => zoomer.zoomBy(1 / 1.6) },
		{ label: t("mapShowCountries"), icon: CenterFocusIcon, act: (zoomer: Zoomer) => { zoomer.reset(); onReset(); } },
	];
	return (
		<div className={twMerge(PANEL, "fixed bottom-4 left-[calc(24rem+0.5rem)] z-10 hidden flex-col gap-0.5 p-1 xl:flex")}>
			{controls.map(({ label, icon, act }) => (
				<Tooltip key={label} content={label} placement="right"><button type="button" aria-label={label} onClick={() => { if (zoomerRef.current) act(zoomerRef.current); }} className={button}><HugeiconsIcon icon={icon} size={16} /></button></Tooltip>
			))}
		</div>
	);
}
