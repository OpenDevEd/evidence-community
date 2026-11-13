import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildLanguageAlternates, buildLocalizedSiteUrl } from "@/lib/language-alternates";
import { getRuntimePageAvailability } from "@/config/library-config/pages";
import Map from "@/components/pages/Map";
import { MAP_HEIGHT, MAP_WIDTH, type MapShape } from "@/components/pages/HomeMap";
import { getWorldMap } from "@/components/pages/home-map-shapes";
import { getLibraryConfig } from "@/config/library-config/server";
import { getPublicFacets } from "@/lib/search";
import { loadSearchParams } from "@/lib/searchParams";
import { geoEqualEarth } from "d3-geo";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { preload } from "react-dom";
import { modeField, modeOf, type CountryMode } from "@/components/pages/map-measure";

type Places = Record<string, [number, number]>;
type Counts = Record<string, number>;
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The map's own title and address, in each language. A filtered map names the plain one, as a filtered list does. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
	await connection();
	const [{ locale }, config, t] = await Promise.all([params, getLibraryConfig(), getTranslations("ui")]);
	// A community without the map answers with the not-found page, which names no address of its own.
	if (!getRuntimePageAvailability(config)["/map"]) return {};
	const { identity, localization } = config;
	return {
		title: `${t("mapTitle")}: ${identity.name}`,
		alternates: {
			canonical: buildLocalizedSiteUrl("/map", locale as typeof localization.defaultLocale, localization, identity.baseUrl),
			languages: buildLanguageAlternates("/map", localization, identity.baseUrl),
		},
	};
}

// Waits for the library settings instead of showing a loading state, so the click lands on the finished page.
// Next.js reads this route export. Fallow does not recognize it yet.
// fallow-ignore-next-line unused-export
export const instant = false;

export default async function MapPage({ searchParams }: Props) {
	await connection();
	const config = await getLibraryConfig();
	if (!getRuntimePageAvailability(config)["/map"]) notFound();
	// The outlines start downloading with the page, not after the map hydrates and asks for them.
	preload("/features.json", { as: "fetch", crossOrigin: "anonymous" });
	preload("/antarctica.json", { as: "fetch", crossOrigin: "anonymous" });
	const places = placesOf((await getWorldMap()).shapes);
	const params = await searchParams;
	const mode = modeOf(params.by, config.filters.institution.mode !== "hidden");
	// The whole library's counts place the map; the counts for the page's filters, chosen countries included, colour it and fill the list from the first frame.
	const [library, filtered] = await Promise.all([countsOf({}, mode), countsOf(loadSearchParams(params), mode)]);
	return <Map focus={library && middleOf(places, library)} places={places} counts={filtered} />;
}

/** Each country's place on the globe (longitude and latitude), by code. `getWorldMap` placed its markers with this projection, so it turns them back into places. */
function placesOf(shapes: MapShape[]): Places {
	const projection = geoEqualEarth().scale(150).translate([MAP_WIDTH / 2, MAP_HEIGHT / 2]);
	return Object.fromEntries(shapes.map((shape) => [shape.code, projection.invert!([shape.x, shape.y]) as [number, number]]));
}

/** Records per country code for these filters, by the map's mode. Without them the map still works: it opens on the whole globe, and the browser fetches the counts. */
async function countsOf(params: Parameters<typeof getPublicFacets>[0], mode: CountryMode): Promise<Counts | undefined> {
	try {
		const facets = await getPublicFacets(params);
		return (facets.facetDistribution?.[`${modeField(mode)}_uncategorized`] ?? {}) as Counts;
	} catch (error) {
		console.error("Map page: the community's country counts could not be read", error);
		return undefined;
	}
}

/** The middle of the countries on the sphere, each weighted by its records; none when the library has no countries. Averaging on the
 * sphere keeps countries either side of the date line (New Zealand and Samoa) together instead of splitting the difference at Greenwich. */
function middleOf(places: Places, counts: Counts): [number, number] | undefined {
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
