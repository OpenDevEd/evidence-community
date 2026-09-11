"use client";

import {
	ComposableMap,
	Geographies,
	Geography,
	ZoomableGroup,
} from "react-simple-maps";
import { ReactNode, useEffect, useState, useRef, memo } from "react";
import { useTranslations } from "next-intl";
import { Tooltip } from "@nextui-org/react";
import { useMouse, useWindowSize } from "@uidotdev/usehooks";
import { useItemsList } from "@/hooks/useItemsList";
import { A3ToA2, COUNTRIES, COUNTRY_PARAMS } from "@/constants/misc";
import ItemsList from "../features/items/ItemsList";
import { AnimatePresence, motion } from "framer-motion";
import { Card } from "@/components/nextui/Card";
import { SearchBar } from "@/components/features/SearchBar";
import { SORT_OPTIONS } from "@/constants/items";
import { twMerge } from "tailwind-merge";
import useBreakpoint from "@/hooks/useBreakpoint";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import {
	formatCssColor,
	generateColorRamp,
} from "@/config/library-config/theme";

type FeatureGeometry = {
	type: "Polygon" | "MultiPolygon";
	arcs: number[][];
	id: string;
	properties: { name: string };
};

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

	return (
		<Tooltip
			updatePositionDeps={[mouse, zoomData]}
			isOpen={!!content}
			content={content}
			className="select-none"
		>
			<div
				style={{
					position: "fixed",
					top: anchor?.y ?? (dragging ? dragging.y : mouse.y),
					left: anchor?.x ?? (dragging ? dragging.x : mouse.x),
					pointerEvents: "none",
				}}
				className="size-0"
			></div>
		</Tooltip>
	);
}

function linearColor(
	start: [number, number, number],
	end: [number, number, number],
	none: [number, number, number],
	ratio: number,
) {
	if (ratio === 0) {
		return `rgb(${none[0]}, ${none[1]}, ${none[2]})`;
	}
	const adjustedRatio = Math.pow(ratio, 0.5);
	const r = Math.round(start[0] + adjustedRatio * (end[0] - start[0]));
	const g = Math.round(start[1] + adjustedRatio * (end[1] - start[1]));
	const b = Math.round(start[2] + adjustedRatio * (end[2] - start[2]));
	return `rgb(${r}, ${g}, ${b})`;
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
		if (isDesktop || panel?.contains(document.activeElement)) return;
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
						"fixed right-0 inset-y-0 top-36 outline-none w-full md:w-auto md:top-0 md:pt-[calc(7.5rem-1.5rem)] md:pr-4 md:pb-4",
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

function Search({ props }: { props: ReturnType<typeof useItemsList> }) {
	return (
		<div className="fixed top-20 md:bottom-0 md:top-auto left-0">
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

export default function Map() {
	const { search, theme } = useLibraryConfig();
	const accentRamp = generateColorRamp(theme.colors.accent);
	const tailwindAccentColor = formatCssColor(accentRamp[600]);
	const RGBAccent = accentRamp[600].slice(0, 3) as [number, number, number];
	const RGBLightAccent = accentRamp[100].slice(0, 3) as [
		number,
		number,
		number,
	];
	const [tooltipContent, setTooltipContent] = useState<ReactNode | null>(
		null,
	);
	const [tooltipAnchor, setTooltipAnchor] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [zoomData, setZoomData] = useState<any>(null);
	const props = useItemsList(undefined, {
		paginationSiblings: 1,
		disableViewSwitch: true,
		interactionsStyle: "one-line",
	});
	const countriesFacet = props.facetDistribution?.country_uncategorized;
	const maxItems = Math.max(
		...Object.values(countriesFacet || {}).map(Number),
	);
	const size = useWindowSize();
	const isDesktop = useBreakpoint("md");

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
			className="w-full h-screen overflow-hidden"
		>
			<MouseTooltip
				content={tooltipContent}
				zoomData={zoomData}
				anchor={tooltipAnchor}
			/>
			<Search props={props} />
			<MemoizedItemView props={props} />
			<div inert={!isDesktop && props.queryParams.country.length > 0}>
				{size.width && size.height && (
					<ComposableMap
						projection="geoEqualEarth"
						projectionConfig={{
							center: [0, 150],
							scale: 600,
						}}
						width={size.width ?? undefined}
						height={size.height ?? undefined}
					>
						<ZoomableGroup
							minZoom={0.35}
							maxZoom={20}
							onMoveEnd={() => setZoomData(null)}
							onMove={(data) => setZoomData(data)}
						>
							<Geographies
								stroke={"black"}
								strokeWidth={0.25}
								geography={geoUrl}
							>
								{({
									geographies,
								}: {
									geographies: FeatureGeometry[];
								}) =>
									geographies.map((geo: FeatureGeometry) => {
										const countryCode = A3ToA2[geo.id];
										const inFacet =
											countriesFacet?.[countryCode];
										const fullLocation =
											COUNTRY_PARAMS[countryCode];
										const selected =
											props.queryParams.country.includes(
												fullLocation,
											);
										const countryName =
											COUNTRIES[countryCode] ||
											geo.properties.name;
										const details = (
											<div className="flex flex-col items-center justify-center">
												<div className="text-sm font-bold">
													{countryName}
												</div>
												<div className="text-xs">
													{inFacet || 0}
												</div>
											</div>
										);
										const selectCountry = () => {
											if (fullLocation)
												props.handleCountrySelect(
													fullLocation,
												);
										};

										return (
											<Geography
												key={geo.id}
												geography={geo}
												role={
													fullLocation
														? "button"
														: "img"
												}
												aria-label={countryName}
												tabIndex={fullLocation ? 0 : -1}
												aria-pressed={
													fullLocation
														? selected
														: undefined
												}
												onKeyDown={(event) => {
													if (
														fullLocation &&
														(event.key ===
															"Enter" ||
															event.key === " ")
													) {
														event.preventDefault();
														if (!event.repeat)
															selectCountry();
													}
												}}
												fill={
													countryCode
														? linearColor(
																RGBLightAccent,
																RGBAccent,
																[100, 100, 100],
																inFacet
																	? inFacet /
																			maxItems
																	: 0,
															)
														: "rgb(255,200,200)"
												}
												onClick={selectCountry}
												onMouseEnter={() => {
													setTooltipAnchor(null);
													setTooltipContent(details);
												}}
												onMouseLeave={() =>
													setTooltipContent(null)
												}
												onFocusCapture={(event) => {
													const bounds =
														event.currentTarget.getBoundingClientRect();
													setTooltipAnchor({
														x: Math.max(
															24,
															Math.min(
																size.width! -
																	24,
																bounds.left +
																	bounds.width /
																		2,
															),
														),
														y: Math.max(
															100,
															Math.min(
																size.height! -
																	80,
																bounds.top,
															),
														),
													});
													setTooltipContent(details);
												}}
												onBlurCapture={() => {
													setTooltipAnchor(null);
													setTooltipContent(null);
												}}
												vectorEffect="non-scaling-stroke"
												className="text-black transition-colors duration-100 dark:text-white"
												style={{
													default: {
														stroke: selected
															? "currentColor"
															: undefined,
														strokeWidth: selected
															? 2
															: undefined,
														outline: "none",
													},
													hover: {
														fill: tailwindAccentColor,
														stroke: "currentColor",
														strokeWidth: 3,
														outline: "none",
													},
													pressed: {
														fill: tailwindAccentColor,
														stroke: "currentColor",
														strokeWidth: 3,
														outline: "none",
													},
												}}
											/>
										);
									})
								}
							</Geographies>
						</ZoomableGroup>
					</ComposableMap>
				)}
			</div>
		</main>
	);
}
