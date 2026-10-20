import { expect, it } from "vitest";

import { pointsOf } from "@/components/pages/map-institutions";

const facets = (counts: Record<string, number>) => ({ facetDistribution: { institutionsWithAuthors: counts } }) as never;
const PLACES = { "ministry of health": [32.6, -25.97, "Maputo", "MZ"], "makerere university": [32.57, 0.33, "Kampala", "UG"] } as never;

it("makes one circle of an institution its records spell more than one way, adding up its records, and leaves out unplaced ones", () => {
	const points = pointsOf(facets({ "Ministry of Health": 7, "Makerere University": 9, "Ministry Of Health": 4, "Nowhere Institute": 30 }), PLACES, undefined);
	expect(points.map(({ key, name, names, count, total }) => ({ key, name, names, count, total }))).toEqual([
		{ key: "ministry of health", name: "Ministry of Health", names: ["Ministry of Health", "Ministry Of Health"], count: 11, total: undefined },
		{ key: "makerere university", name: "Makerere University", names: ["Makerere University"], count: 9, total: undefined },
	]);
});

it("gives each institution's whole-library records, all its spellings together, and nothing where the library's counts lack it", () => {
	const points = pointsOf(facets({ "Ministry of Health": 1, "Ministry Of Health": 1, "Makerere University": 2 }), PLACES, { "Ministry of Health": 20, "Ministry Of Health": 5 });
	expect(Object.fromEntries(points.map((point) => [point.key, point.total]))).toEqual({ "ministry of health": 25, "makerere university": undefined });
});
