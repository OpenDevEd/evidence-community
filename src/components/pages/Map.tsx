"use client";

import {
	ComposableMap,
	Geographies,
	Geography,
	ZoomableGroup,
} from "react-simple-maps";
import { style, themeColors } from "../../../tailwind.config";
import { ReactNode, useEffect, useRef, useState, memo } from "react";
import {Tooltip } from "@heroui/react";
import { useLocalStorage, useWindowSize } from "usehooks-ts";
import { useItemsList } from "@/hooks/useItemsList";
import { A3ToA2, COUNTRIES, COUNTRY_PARAMS, countryFacetOptions } from "@/constants/misc";
import ItemsList from "../features/items/ItemsList";
import { AnimatePresence, motion } from "framer-motion";
import { useFacetList } from "@/hooks/useFacetList";
import { Input } from "../heroui/Input";
import { SearchBar } from "./EvidenceLibrary";
import { SCOPE_OPTIONS, SORT_OPTIONS } from "@/constants/items";
import { twMerge } from "tailwind-merge";
import useBreakpoint from "@/hooks/useBreakpoint";
import { createPortal } from "react-dom";
import { Select } from "../heroui/Select";
import { SelectItem } from "../heroui/SelectItem";
import { useTranslations } from "next-intl";
import { searchParamsLoader } from "@/lib/searchParams";
import { inferParserType } from "nuqs/server";
import { useMousePosition } from "@/hooks/useMousePosition";

export type FeatureCollection = {
	type: "FeatureCollection";
	transform: {
		scale: [number, number];
		translate: [number, number];
	};
	objects: {
		world: {
			type: "GeometryCollection";
			geometries: FeatureGeometry[];
		};
	};
	arcs: number[][];
};

export type FeatureGeometry = {
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
}: {
	content: ReactNode | null;
	zoomData: any;
}) {
	const mouse = useMousePosition();
	const dragging = zoomData?.dragging;
	const isDesktop = useBreakpoint("md");

	if (!isDesktop) {
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
					top: dragging ? dragging.y : mouse.y,
					left: dragging ? dragging.x : mouse.x,
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
	ratio: number
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

function HEXToRGB(hex: string): [number, number, number] {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return [r, g, b];
}

function ItemView({ props }: { props: ReturnType<typeof useItemsList> }) {
	const isCountrySelected = countryFacetOptions.some(facet => (props.queryParams[facet.queryParam] as string[]).length > 0);

	return (
		<AnimatePresence>
			{isCountrySelected && (
				<motion.div
					className={twMerge("fixed right-0 inset-y-0 top-36 md:top-0 md:pt-[calc(7.5rem-1.5rem)] md:pr-4 md:pb-4", style === "small" && "md:pt-[calc(7.5rem)]")}
					initial={{ opacity: 0, x: 100 }}
					animate={{ opacity: 1, x: 0 }}
					exit={{ opacity: 0, x: 100 }}
					transition={{ duration: 0.3 }}
				>
					<div className="w-screen md:w-[32rem] h-full rounded-2xl overflow-y-scroll overflow-x-hidden no-scrollbar">
						<div className="bg-white dark:bg-secondary-400 p-4 min-h-full">
							<ItemsList props={props} />
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

const MemoizedItemView = memo(ItemView, (prevProps, nextProps) => {
	return prevProps.props === nextProps.props;
});

function Search({ props, setMapFacet, mapFacet }: { props: ReturnType<typeof useItemsList>, setMapFacet: (facet: number) => void, mapFacet: number }) {
	const t = useTranslations("ui");

	return (
		<div className="fixed top-20 md:bottom-0 md:top-auto left-0">
			<div className="w-screen md:w-[42rem] md:p-4">
				<div className="bg-white dark:bg-secondary-400 md:rounded-2xl flex gap-4 p-2 shadow-[0_-10px_10px_0_theme(colors.accent.500)] md:shadow-none">
					<SearchBar handleSearchChange={props.handleSearchChange} search={props.queryParams.search}/>
					<Select classNames={{
						trigger: "h-10 lg:h-12"
						}} placement="left" color="tertiary" label="Facet" selectedKeys={[String(mapFacet)]} onSelectionChange={(keys) => setMapFacet(Number(keys.currentKey))}>
							{countryFacetOptions.map((facet, index) => (
								<SelectItem key={String(index)}>{t(facet.label)}</SelectItem>
							))}
						</Select>
				</div>
			</div>
		</div>
	);
}


export default function Map() {
	const tailwindAccentColor = themeColors.accent[600];
	const lightAccentColor = themeColors.accent[100];
	const RGBAccent = HEXToRGB(tailwindAccentColor);
	const RGBLightAccent = HEXToRGB(lightAccentColor);
	const [tooltipContent, setTooltipContent] = useState<ReactNode | null>(
		null
	);
	const [zoomData, setZoomData] = useState<any>(null);
	const props = useItemsList(undefined, {
		paginationSiblings: 1,
		disableViewSwitch: true,
		interactionsStyle: "one-line",
	});
	const [mapFacetValue, setMapFacet] = useLocalStorage("mapFacet", 0);
	const mapFacet = countryFacetOptions[mapFacetValue] ? mapFacetValue : 0;
	const countriesFacet = props?.itemsData?.facetDistribution?.[countryFacetOptions[mapFacet].key + "_uncategorized"];
	const maxItems = Math.max(
		...Object.values(countriesFacet || {}).map(Number)
	);
	const size = useWindowSize();

	useEffect(() => {
		const country = props.queryParams.country
		if (country.length === 0) {
			if (props.queryParams.sort) {
				props.handleSortChange(new Set([SORT_OPTIONS[0].key]));
			}
			if (props.queryParams.scope) {
				props.handleScopeChange(new Set([SCOPE_OPTIONS[0].key]));
			}
			if (props.queryParams.page) {
				props.handlePageChange(1);
			}
		}
	}, [props.queryParams.country])

	return (
		<div className="w-full h-screen overflow-hidden">
			<MouseTooltip content={tooltipContent} zoomData={zoomData} />
			{size.width && size.height && <ComposableMap projection="geoEqualEarth" projectionConfig={{
				center: [0, 150],
				scale: 600,
			}} width={size.width ?? undefined} height={size.height ?? undefined}>
				<ZoomableGroup
					minZoom={0.35}
					maxZoom={20}
					onMoveEnd={() => setZoomData(null)}
					onMove={(data) => setZoomData(data)}
				>
					<Geographies
					
						stroke={"black"}
						strokeWidth={0.25}
					geography={geoUrl}>
						{({
							geographies,
						}: {
							geographies: FeatureGeometry[];
						}) =>
							geographies.map((geo: FeatureGeometry) => {
								const countryCode = A3ToA2[geo.id];
								const inFacet = countriesFacet?.[countryCode];
								const fullLocation = COUNTRY_PARAMS[countryCode];

								return (
									<Geography
										key={geo.id}
										geography={geo}
										fill={
											countryCode
												? linearColor(
														RGBLightAccent,
														RGBAccent,
														[100, 100, 100],
														inFacet
															? inFacet / maxItems
															: 0
												  )
												: "rgb(255,200,200)"
										}
										onClick={() => {
											props[countryFacetOptions[mapFacet].action](
												fullLocation
											);
										}}
										onMouseEnter={() =>
											setTooltipContent(
												<div className="flex flex-col justify-center items-center">
													<div className="text-sm font-bold">
														{COUNTRIES[
															countryCode
														] ||
															geo.properties.name}
													</div>
													<div className="text-xs">
														{inFacet || 0}
													</div>
												</div>
											)
										}
										onMouseLeave={() =>
											setTooltipContent(null)
										}
										className="transition-colors duration-100"
										style={{
											default: {
												outline: "none",
											},
											hover: {
												fill: tailwindAccentColor,
												outline: "none",
											},
											pressed: {
												fill: tailwindAccentColor,
												outline: "none",
											},
										}}
									/>
								);
							})
						}
					</Geographies>
				</ZoomableGroup>
			</ComposableMap>}
			<Search props={props} setMapFacet={setMapFacet} mapFacet={mapFacet} />
			<MemoizedItemView props={props} />
		</div>
	);
}
