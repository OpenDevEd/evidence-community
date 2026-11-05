import { describe, expect, it } from "vitest";

import { statisticsCacheKey } from "@/app/[locale]/statistics/queries/statistics-cache-key";

const config = { content: { tags: { hidden: ["private", "draft"] } }, services: { database: { url: "postgresql://one" } }, topics: { enabled: true } } as Parameters<typeof statisticsCacheKey>[0];
const shown = new Map([["AAAA1111", { title: "Tutoring" }]]);
const key = statisticsCacheKey(config, shown, "library");

describe("the name saved statistics go by", () => {
	it("stays through a revision that changes nothing they count, whatever order hidden tags are listed in", () => {
		const republished = { ...config, revision: "r45", identity: { name: "Renamed" } };
		expect(statisticsCacheKey(republished, shown, "library")).toBe(key);
		const reordered = { ...config, content: { tags: { hidden: ["draft", "private"] } } } as typeof config;
		expect(statisticsCacheKey(reordered, shown, "library")).toBe(key);
	});

	it("changes with what they count", () => {
		const hiding = { ...config, content: { tags: { hidden: ["private"] } } } as typeof config;
		expect(statisticsCacheKey(hiding, shown, "library")).not.toBe(key);
		expect(statisticsCacheKey({ ...config, topics: { enabled: false } }, shown, "library")).not.toBe(key);
		expect(statisticsCacheKey(config, new Map([["AAAA1111", { title: "Renamed" }]]), "library")).not.toBe(key);
		expect(statisticsCacheKey(config, shown, "openalex")).not.toBe(key);
		const moved = { ...config, services: { database: { url: "postgresql://two" } } } as typeof config;
		expect(statisticsCacheKey(moved, shown, "library")).not.toBe(key);
	});
});
