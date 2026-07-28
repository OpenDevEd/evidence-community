import { describe, expect, it } from "vitest";

import {
	findEnabledGapMap,
	getEnabledGapMaps,
	getGapMapPath,
	isApprovedGapMapContentType,
} from "@/config/library-config/gap-maps";
import { libraryConfigSchema } from "@/config/library-config/schema";
import {
	cloneLibraryConfig,
	maximalLibraryConfig,
} from "../fixtures/library-config";

function gapMaps() {
	const config = cloneLibraryConfig(maximalLibraryConfig);
	config.gapMaps!.push({
		id: "disabled-map",
		slug: "disabled-map",
		label: "Disabled map",
		sourceUrl:
			"https://assets.example.org/gapmaps/disabled-map.html",
		enabled: false,
	});

	return libraryConfigSchema.parse(config).gapMaps;
}

describe("runtime gap maps", () => {
	it("projects only enabled maps through same-origin paths", () => {
		expect(getEnabledGapMaps(gapMaps())).toEqual([
			{
				slug: "gap-map-one",
				label: "Gap map one",
				description: "A configured evidence gap map.",
				href: "/gapmaps/gap-map-one.html",
			},
		]);
	});

	it("finds only enabled configured slugs", () => {
		expect(
			findEnabledGapMap(gapMaps(), "gap-map-one")?.sourceUrl,
		).toBe(
			"https://assets.example.org/gapmaps/gap-map-one.html",
		);
		expect(findEnabledGapMap(gapMaps(), "disabled-map")).toBeUndefined();
		expect(findEnabledGapMap(gapMaps(), "unknown")).toBeUndefined();
	});

	it("builds the canonical same-origin path", () => {
		expect(getGapMapPath("evidence-map")).toBe(
			"/gapmaps/evidence-map.html",
		);
	});

	it.each([
		["text/html", true],
		["text/html; charset=utf-8", true],
		["application/xhtml+xml", true],
		["text/plain", false],
		[null, false],
	] as const)(
		"validates upstream content type %s",
		(contentType, approved) => {
			expect(isApprovedGapMapContentType(contentType)).toBe(
				approved,
			);
		},
	);
});
