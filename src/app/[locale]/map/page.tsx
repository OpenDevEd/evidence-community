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

type Places = Record<string, [number, number]>;

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
	const places = placesOf((await getWorldMap()).shapes);
	const focus = await focusOf(places).catch((error: unknown) => {
		// Without it the map opens on the whole globe, so the page still works.
		console.error("Map page: the library's countries could not be read for the starting point", error);
		return undefined;
	});
	return <Map focus={focus} places={places} />;
}

/** Each country's place on the globe (longitude and latitude), by code. `getWorldMap` placed its markers with this projection, so it turns them back into places. */
function placesOf(shapes: MapShape[]): Places {
	const projection = geoEqualEarth().scale(150).translate([MAP_WIDTH / 2, MAP_HEIGHT / 2]);
	return Object.fromEntries(shapes.map((shape) => [shape.code, projection.invert!([shape.x, shape.y]) as [number, number]]));
}

/** Where the map opens: the middle of the library's countries, each weighted by its records, as a longitude and latitude. */
async function focusOf(places: Places) {
	const facets = await getPublicFacets({});
	return middleOf(places, countsOf((facets.facetDistribution?.country ?? {}) as Record<string, number>));
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

/** The middle of the countries on the sphere, each weighted by its records; none when the library has no countries. Averaging on the
 * sphere keeps countries either side of the date line (New Zealand and Samoa) together instead of splitting the difference at Greenwich. */
function middleOf(places: Places, counts: Record<string, number>): [number, number] | undefined {
	let total = 0;
	const sum = [0, 0, 0];
	for (const [code, place] of Object.entries(places)) {
		const count = counts[code] ?? 0;
		total += count;
		unitOf(place).forEach((value, axis) => (sum[axis] += value * count));
	}
	return total ? placeOf(sum) : undefined;
}

const RADIANS = Math.PI / 180;

/** A place as a point on the unit sphere. */
function unitOf([longitude, latitude]: [number, number]) {
	const [lambda, phi] = [longitude * RADIANS, latitude * RADIANS];
	return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}

/** The place a point in space points at, as a longitude and latitude. */
function placeOf([x, y, z]: number[]): [number, number] {
	return [Math.atan2(y, x) / RADIANS, Math.atan2(z, Math.hypot(x, y)) / RADIANS];
}
