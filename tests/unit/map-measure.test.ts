import { expect, it } from "vitest";

import { countryRows, scaleTop } from "@/components/pages/map-measure";

// Kenya 241 records in 57.5 million people, Monaco 16 in 38,341, China 9,010 in 1.41 billion; Anguilla has no population figure.
const FACET = { KE: 241, MC: 16, CN: 9010, AI: 5, ZZ: 3 };

it("ranks countries by records per million people, with countries of unknown population last", () => {
	const rows = countryRows(FACET, "people");
	expect(rows.map((row) => row.code)).toEqual(["MC", "CN", "KE", "AI"]);
	expect(rows[0].value).toBeCloseTo(417.3, 1);
	expect(rows[2].value).toBeCloseTo(4.19, 2);
	expect(rows[3]).toMatchObject({ code: "AI", count: 5, value: null });
});

it("ranks countries by their records when asked for totals, and leaves out codes the region filter doesn't know", () => {
	expect(countryRows(FACET, "records").map((row) => [row.code, row.value])).toEqual([["CN", 9010], ["KE", 241], ["MC", 16], ["AI", 5]]);
});

it("tops the per-person colour at the 95th percentile so one tiny state doesn't pale the rest, and totals at the busiest", () => {
	const values = Array.from({ length: 40 }, (_, k) => ({ value: 400 - k * 10 }));
	expect(scaleTop(values, "people")).toBe(380);
	expect(scaleTop(values, "records")).toBe(400);
	expect(scaleTop([{ value: null }], "people")).toBe(1);
});
