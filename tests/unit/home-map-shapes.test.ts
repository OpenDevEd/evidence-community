import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getWorldMap } from "@/components/pages/home-map-shapes";
import { MAP_HEIGHT, MAP_WIDTH } from "@/components/pages/HomeMap";

describe("the home page's world map", () => {
	it("draws every country under its code and places its marker on the map", async () => {
		const { svg, shapes } = await getWorldMap();

		expect(svg).toMatch(/^<svg [^>]*><g id="land">.*<\/g><\/svg>$/);
		const kenya = shapes.find((shape) => shape.code === "KE");
		expect(kenya).toBeDefined();
		expect(svg).toContain('<path id="KE" d="M');
		expect(kenya!.x).toBeGreaterThan(MAP_WIDTH / 2);
		expect(kenya!.y).toBeGreaterThan(0);
		expect(kenya!.y).toBeLessThan(MAP_HEIGHT);
		// Every marker has an outline to go with it.
		expect(shapes.every((shape) => svg.includes(`id="${shape.code}"`))).toBe(true);
	});

	it("projects the world once per process", async () => {
		expect(getWorldMap()).toBe(getWorldMap());
	});
});
