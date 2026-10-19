"use client";

import { geoEqualEarth, geoGraticule, geoPath } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity, zoomTransform, type ZoomTransform } from "d3-zoom";
import { feature } from "topojson-client";
import { flushSync } from "react-dom";
import { Fragment, ReactNode, Suspense, use, useEffect, useEffectEvent, useMemo, useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { CenterFocusIcon, MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Tooltip } from "@/components/nextui/Tooltip";
import { CountryFlag } from "@/components/statistics/CountryFlag";
import { useMouse, useWindowSize } from "@uidotdev/usehooks";
import { useItemsList } from "@/hooks/useItemsList";
import { A3ToA2, COUNTRIES, COUNTRY_PARAMS } from "@/constants/misc";
import { PANEL } from "./evidence/lists";
import { countryRows, MapPanel, MapSheet, perMillion, useMeasure, useValueFormat, type Measure } from "./map-panel";
import { SORT_OPTIONS } from "@/constants/items";
import { twMerge } from "@/lib/tw-merge";
import useBreakpoint from "@/hooks/useBreakpoint";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

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

type Feature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { name: string }> & { id: string };
/** The outlines the globe draws: the countries, and Antarctica, which has no records and isn't in the countries file. */
type World = { countries: Feature[]; antarctica: Feature[] };
/** A country on the map: `location` is its place in the region filter, when it has one. */
type Country = { code?: string; location?: string; name: string; count: number; value: number | null; selected: boolean };
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
/** How far, at least, the map starts zoomed in on the library's countries on a wide screen. */
const START_ZOOM = 1.8;
/** How far past the screen's edges the map is drawn on a wide screen, so sliding it towards a chosen country never shows its edge. */
const PAD = 600;

function countryOf(geo: Feature, facet: Record<string, number>, chosen: string[], measure: Measure): Country {
	const code = A3ToA2[geo.id] as string | undefined;
	if (!code) return { name: geo.properties.name, count: 0, value: null, selected: false };
	const location = COUNTRY_PARAMS[code] as string | undefined;
	const count = facet[code] ?? 0;
	return { code, location, name: nameOf(code, geo), count, value: measure === "people" ? perMillion(code, count) : count, selected: chosen.includes(location ?? "") };
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
	const [left, top] = projection.translate();
	return { projection: projection.translate([left + frame.width / 2 - x, top]), minZoom: 1 };
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
	return { projection, minZoom: 1 / zoom };
}

/** Moves the globe up or down only as far as keeps it covering the screen from top to bottom. */
function coverY(projection: ReturnType<typeof geoEqualEarth>, frame: Frame, y: number) {
	const [[, top], [, bottom]] = geoPath(projection).bounds(SPHERE);
	return Math.min(frame.pad - top, Math.max(frame.height + frame.pad - bottom, y));
}

/** The slide that puts a point at screen position `x` in the middle of the space beside the panel, no further than the map is drawn past the screen. */
function slideFrom(frame: Frame, x: number) {
	const gap = (frame.listWidth + frame.width) / 2;
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

/** The country pointed at: its flag and name, its records for each million people where its population is known, and its records. */
function CountryTip({ country }: { country: Country }) {
	const { rate, count } = useValueFormat();
	const people = country.code ? perMillion(country.code, country.count) : null;
	const number = "font-semibold tabular-nums text-black dark:text-white";
	return (
		<div className="flex flex-col gap-0.5 px-1 py-0.5">
			<div className="flex items-center gap-2 text-sm font-semibold">
				{country.code && <CountryFlag countryCode={country.code} className="h-3 w-[1.125rem] rounded-[2px]" />}
				{country.name}
			</div>
			<div className="flex gap-3 text-xs text-black/60 dark:text-white/60">
				{people !== null && country.count > 0 && <span><strong className={number}>{rate(people)}</strong> per million people</span>}
				<span><strong className={number}>{count(country.count)}</strong> records</span>
			</div>
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
/** The zoom buttons' way into d3-zoom, set while the globe is on the page. */
type Zoomer = { zoomBy: (k: number) => void; reset: () => void };

const GRATICULE = geoGraticule().step([15, 15])();

/** How a gesture moves the drawn map, from the zoom the SVG was drawn at (`from`) to where the gesture is now (`to`). */
function cssTransform(from: ZoomTransform, to: ZoomTransform) {
	const scale = to.k / from.k;
	return `translate(${to.x - scale * from.x}px, ${to.y - scale * from.y}px) scale(${scale})`;
}

/** The globe, once its outlines have arrived. Until then the page shows nothing here, and the globe fades in whole when they do. */
function Globe({ view, ...rest }: { view: View | null } & Omit<Parameters<typeof GlobeView>[0], "view" | "world">) {
	if (!view) return null;
	const loaded = use(loadWorld());
	return loaded && <GlobeView view={view} world={loaded} {...rest} />;
}

/** A shaded sea, Antarctica, a faint graticule and the countries, drawn past the screen's edges on a wide screen and slid sideways by `offset`.
 * Zooming and panning move the drawn map as one composited layer with a CSS transform, so Firefox redraws nothing while a gesture runs;
 * when it ends, the zoom is committed to the SVG and the outlines are redrawn sharp at the new scale. Nothing here is blurred or
 * transitioned: Firefox redraws a blur, or a fading fill, across the whole globe on every frame, which kept a core or more busy. */
function GlobeView({ view, world, offset, zoomerRef, renderCountry }: { view: View; world: World; offset: number; zoomerRef: React.RefObject<Zoomer | null>; renderCountry: (geo: Feature, d: string) => ReactNode }) {
	const stage = useRef<HTMLDivElement>(null);
	// The buttons zoom about the middle of the space beside the panel, in the stage's own coordinates, wherever the map is slid.
	const middle = useEffectEvent((): [number, number] => [(view.frame.listWidth + view.frame.width) / 2 + view.frame.pad - offset, view.frame.height / 2 + view.frame.pad]);
	const layer = useRef<HTMLDivElement>(null);
	const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
	const { pad, width, height } = view.frame;
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
		const behaviour = zoom<HTMLDivElement, unknown>()
			.scaleExtent([view.minZoom, 12])
			.duration(0)
			.on("start", (event: { sourceEvent: unknown }) => {
				active += 1;
				// A reader's own gesture moves the map at once, even over a button's glide.
				if (event.sourceEvent) moving.style.transition = "";
				moving.style.willChange = "transform";
			})
			.on("zoom", (event: { transform: ZoomTransform }) => {
				moving.style.transform = cssTransform(committed, event.transform);
			})
			.on("end", (event: { transform: ZoomTransform }) => {
				const commit = () => {
					active -= 1;
					committed = event.transform;
					flushSync(() => setTransform(committed));
					moving.style.transition = "";
					moving.style.transform = "";
					if (!active) moving.style.willChange = "";
				};
				if (!moving.style.transition) return commit();
				// A button's zoom glides the layer there first, then draws the outlines sharp at the new zoom. A glide that goes
				// nowhere never ends, so the commit also runs after the glide's length.
				let done = false;
				const once = () => { if (!done) { done = true; commit(); } };
				moving.addEventListener("transitionend", once, { once: true });
				setTimeout(once, GLIDE + 50);
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
			zoomerRef.current = null;
			select(element).on(".zoom", null);
		};
	}, [view.minZoom, view.frame, zoomerRef]);

	return (
		<div ref={stage} className="absolute transition-transform duration-500 ease-out motion-reduce:transition-none" style={{ left: -pad, top: -pad, width: width + 2 * pad, height: height + 2 * pad, transform: `translateX(${offset}px)` }}>
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
					</g>
				</svg>
			</div>
		</div>
	);
}

/** The value that takes the full colour. Per person, a few small states (Monaco: 16 records, 38,000 people) sit far above the rest,
 * so the top 5% share the full colour and the others spread over the whole ramp. Records keep the busiest country as the top. */
function scaleTop(rows: { value: number | null }[], measure: Measure) {
	const values = rows.flatMap((row) => (row.value ? [row.value] : []));
	if (!values.length) return 1;
	return measure === "people" ? values[Math.floor(values.length * 0.05)] : values[0];
}

const NO_COUNTS: Record<string, number> = {};

/** The countries' record counts: the shared filters' facets once they arrive, and until then the counts the server sent with the page. */
function facetOf(props: ReturnType<typeof useItemsList>, initial?: Record<string, number>) {
	return (props.facetDistribution?.country_uncategorized ?? initial ?? NO_COUNTS) as Record<string, number>;
}


/** The counts the map colours by: with a country chosen the search counts only its records, so the counts from before it was chosen are kept. */
function useKeptFacet(facet: Record<string, number>, choosing: boolean) {
	const [kept, setKept] = useState(facet);
	if (!choosing && kept !== facet) setKept(facet);
	return choosing ? kept : facet;
}

/** `counts` are the countries' record counts for the page's filters, so the list and the colours are there from the first frame. */
export default function Map({ focus, places, counts }: { focus?: [number, number]; places: Places; counts?: Record<string, number> }) {
	const [tooltipContent, setTooltipContent] = useState<ReactNode | null>(
		null,
	);
	const [tooltipAnchor, setTooltipAnchor] = useState<Anchor>(null);
	const [hovered, setHovered] = useState<string | null>(null);
	const props = useItemsList(undefined, {
		paginationSiblings: 1,
		disableViewSwitch: true,
		interactionsStyle: "one-line",
	});
	const [measure, setMeasure] = useMeasure();
	const chosen = props.queryParams.country;
	const facet = useKeptFacet(facetOf(props, counts), chosen.length > 0);
	const rows = countryRows(facet, measure);
	const max = scaleTop(rows, measure);
	const size = useWindowSize();
	const isDesktop = useBreakpoint("md");
	const smallLayout = useLibraryConfig().theme.layout === "small";
	// The panel shows from 1,280 px wide; below that the map has the width and a sheet holds the list.
	const listWidth = useBreakpoint("xl") ? PANEL_WIDTH : 0;
	const view = useMemo(() => mapView(size.width, size.height, isDesktop, listWidth, focus), [size.width, size.height, isDesktop, listWidth, focus]);
	const zoomerRef = useRef<Zoomer | null>(null);

	// Choosing a country slides the map sideways so it sits in the middle of the space beside the panel, as its records slide in.
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
			if (props.queryParams.page) {
				props.handlePageChange(1);
			}
		}
	}, [props.queryParams.country]);

	const panel = { props, rows, facet, measure, onMeasure: (next: Measure) => void setMeasure(next), tint: (value: number | null) => tint(value, max), hovered, onHover: setHovered, onSelect: selectCountry, smallLayout };
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
			<ZoomControls zoomerRef={zoomerRef} />
			<Suspense fallback={null}>
				<Globe
					view={view}
					offset={offset}
					zoomerRef={zoomerRef}
					renderCountry={(geo, d) => {
						const country = countryOf(geo, facet, chosen, measure);
						return <CountryShape d={d} country={country} style={shapeStyle(country, hovered, max)} onSelect={selectCountry} onShow={showCountry} onHide={hideCountry} />;
					}}
				/>
			</Suspense>
		</main>
	);
}

/** Zoom, from 1,280 px wide: at the map's bottom left, beside the panel, as on the evidence map. */
function ZoomControls({ zoomerRef }: { zoomerRef: React.RefObject<Zoomer | null> }) {
	const button = "grid size-9 place-items-center rounded-xl outline-none transition-colors hover:bg-black/[0.05] focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/10";
	const controls = [
		{ label: "Zoom in", icon: PlusSignIcon, act: (zoomer: Zoomer) => zoomer.zoomBy(1.6) },
		{ label: "Zoom out", icon: MinusSignIcon, act: (zoomer: Zoomer) => zoomer.zoomBy(1 / 1.6) },
		{ label: "Show the library's countries", icon: CenterFocusIcon, act: (zoomer: Zoomer) => zoomer.reset() },
	];
	return (
		<div className={twMerge(PANEL, "fixed bottom-4 left-[calc(24rem+0.5rem)] z-10 hidden flex-col gap-0.5 p-1 xl:flex")}>
			{controls.map(({ label, icon, act }) => (
				<Tooltip key={label} content={label} placement="right"><button type="button" aria-label={label} onClick={() => { if (zoomerRef.current) act(zoomerRef.current); }} className={button}><HugeiconsIcon icon={icon} size={16} /></button></Tooltip>
			))}
		</div>
	);
}
