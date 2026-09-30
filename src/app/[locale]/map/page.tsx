import { getRuntimePageAvailability } from "@/config/library-config/pages";
import Map from "@/components/pages/Map";
import { MAP_HEIGHT, MAP_WIDTH, type MapShape } from "@/components/pages/HomeMap";
import { getWorldMap } from "@/components/pages/home-map-shapes";
import { getLibraryConfig } from "@/config/library-config/server";
import { getPublicFacets } from "@/lib/search";
import { geoEqualEarth } from "d3-geo";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { preload } from "react-dom";

// Waits for the library settings instead of showing a loading state, so the click lands on the finished page.
// Next.js reads this route export. Fallow does not recognize it yet.
// fallow-ignore-next-line unused-export
export const instant = false;

export default async function MapPage() {
	await connection();
	const config = await getLibraryConfig();
	if (!getRuntimePageAvailability(config)["/map"]) notFound();
	// The outlines start downloading with the page, not after the map hydrates and asks for them.
	preload("/features.json", { as: "fetch", crossOrigin: "anonymous" });
	preload("/antarctica.json", { as: "fetch", crossOrigin: "anonymous" });
	const { shapes } = await getWorldMap();
	const focus = await focusOf(shapes).catch((error: unknown) => {
		// Without it the map opens on the whole globe, so the page still works.
		console.error("Map page: the library's countries could not be read for the starting point", error);
		return undefined;
	});
	return <Map focus={focus} places={placesOf(shapes)} />;
}

/** The projection `getWorldMap` placed the country markers with, so it turns a marker's position back into a place. */
function worldProjection() {
	return geoEqualEarth().scale(150).translate([MAP_WIDTH / 2, MAP_HEIGHT / 2]);
}

/** Each country's place on the globe (longitude and latitude), by code. */
function placesOf(shapes: MapShape[]) {
	const projection = worldProjection();
	return Object.fromEntries(shapes.map((shape) => [shape.code, projection.invert!([shape.x, shape.y]) as [number, number]]));
}

/** Where the map opens: the middle of the library's countries, each weighted by its records, as a longitude and latitude. */
async function focusOf(shapes: MapShape[]) {
	const facets = await getPublicFacets({});
	const middle = middleOf(shapes, countsOf((facets.facetDistribution?.country ?? {}) as Record<string, number>));
	return middle && (worldProjection().invert!(middle) as [number, number]);
}

/** Records per country code. The facet counts by region path ("Africa > Western Africa > NG"). */
function countsOf(distribution: Record<string, number>) {
	const counts: Record<string, number> = {};
	for (const [path, count] of Object.entries(distribution)) {
		const code = path.split(" > ").at(-1)!;
		counts[code] = (counts[code] ?? 0) + count;
	}
	return counts;
}

/** The middle of the countries' marker positions, each weighted by its records; none when the library has no countries. */
function middleOf(shapes: MapShape[], counts: Record<string, number>): [number, number] | undefined {
	let total = 0;
	let x = 0;
	let y = 0;
	for (const shape of shapes) {
		const count = counts[shape.code] ?? 0;
		total += count;
		x += shape.x * count;
		y += shape.y * count;
	}
	return total ? [x / total, y / total] : undefined;
}
