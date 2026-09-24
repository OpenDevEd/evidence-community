import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { geoCentroid, geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import { A3ToA2 } from "@/constants/misc";
import { MAP_HEIGHT, MAP_WIDTH, type MapShape } from "./HomeMap";

let world: Promise<{ svg: string; shapes: MapShape[] }> | undefined;

/** The world projected once per server process: the outlines as one SVG file the browser downloads once and keeps (`/maps/world.svg`, each country's path under its code), and where a marker for each country sits. */
export function getWorldMap() {
	world ??= readFile(path.join(process.cwd(), "public/features.json"), "utf8").then((text) => {
		const topology = JSON.parse(text) as { objects: { world: unknown } };
		const countries = feature(topology, topology.objects.world).features;
		const projection = geoEqualEarth().scale(150).translate([MAP_WIDTH / 2, MAP_HEIGHT / 2]);
		const outline = geoPath(projection);
		const round = (value: number) => Math.round(value * 10) / 10;
		const paths: string[] = [];
		const shapes: MapShape[] = [];
		for (const country of countries) {
			const d = outline(country)?.replace(/\d+\.\d+/g, (value) => String(round(Number(value))));
			if (!d) continue;
			const code = A3ToA2[String(country.id)];
			paths.push(code ? `<path id="${code}" d="${d}"/>` : `<path d="${d}"/>`);
			if (!code) continue;
			const [x, y] = projection(geoCentroid(country)) ?? [0, 0];
			shapes.push({ code, x: round(x), y: round(y) });
		}
		return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}"><g id="land">${paths.join("")}</g></svg>`, shapes };
	});
	return world;
}
