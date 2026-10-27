import { describe, expect, it } from "vitest";

import { fuseRanks } from "@/lib/search-engines/rank-fusion";

describe("mixing ranked lists", () => {
	it("ranks by each list's weight over 60 plus the rank", () => {
		// a: 0.3/61 + 0.7/63, b: 0.3/62, c: 0.3/63 + 0.7/61, d: 0.7/62.
		const order = fuseRanks([
			{ weight: 0.3, keys: ["a", "b", "c"] },
			{ weight: 0.7, keys: ["c", "d", "a"] },
		]);
		expect(order).toEqual(["c", "a", "d", "b"]);
	});

	it("keeps the first list's order for keys that score the same", () => {
		expect(
			fuseRanks([
				{ weight: 0.5, keys: ["a", "b"] },
				{ weight: 0.5, keys: ["b", "a"] },
			]),
		).toEqual(["a", "b"]);
	});
});
